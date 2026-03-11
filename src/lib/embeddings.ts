import { pipeline } from "@xenova/transformers";

// --- Types ---

export interface EmbeddingProvider {
  embed(text: string): Promise<number[]>;
  embedBatch(texts: string[]): Promise<number[][]>;
  dimensions: number;
}

// --- Text Preprocessing ---

export function preprocessText(text: string): string {
  let t = text;
  // Strip markdown formatting
  t = t.replace(/```[\s\S]*?```/g, " "); // code blocks
  t = t.replace(/`[^`]+`/g, " "); // inline code
  t = t.replace(/[#*_~>[\]()!]/g, ""); // markdown chars
  t = t.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1"); // links
  // Normalize whitespace
  t = t.replace(/\s+/g, " ").trim();
  // Truncate to ~512 tokens (~2048 chars as rough approximation)
  if (t.length > 2048) t = t.slice(0, 2048);
  return t;
}

// --- Local Provider (Xenova/transformers) ---

let extractor: any = null;

async function getExtractor(): Promise<any> {
  if (!extractor) {
    extractor = await pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2");
  }
  return extractor;
}

class LocalEmbeddingProvider implements EmbeddingProvider {
  dimensions = 384;

  async embed(text: string): Promise<number[]> {
    const ext = await getExtractor();
    const processed = preprocessText(text);
    const output = await ext(processed, { pooling: "mean", normalize: true });
    return Array.from(output.data as Float32Array);
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    const results: number[][] = [];
    for (const text of texts) {
      results.push(await this.embed(text));
    }
    return results;
  }
}

// --- OpenAI Provider ---

class OpenAIEmbeddingProvider implements EmbeddingProvider {
  dimensions = 1536;
  private apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async embed(text: string): Promise<number[]> {
    const [result] = await this.embedBatch([text]);
    return result;
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    const results: number[][] = [];
    const processed = texts.map(preprocessText);

    // Batch up to 100 at a time
    for (let i = 0; i < processed.length; i += 100) {
      const batch = processed.slice(i, i + 100);
      const resp = await fetch("https://api.openai.com/v1/embeddings", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ model: "text-embedding-3-small", input: batch }),
      });

      if (!resp.ok) {
        const err = await resp.text();
        throw new Error(`OpenAI embeddings API error ${resp.status}: ${err}`);
      }

      const data = await resp.json();
      // Sort by index to preserve order
      const sorted = data.data.sort((a: any, b: any) => a.index - b.index);
      for (const item of sorted) {
        results.push(item.embedding);
      }
    }

    return results;
  }
}

// --- Voyage AI Provider ---

class VoyageEmbeddingProvider implements EmbeddingProvider {
  dimensions = 1024;
  private apiKey: string;
  private model: string;

  constructor(apiKey: string, model = "voyage-3") {
    this.apiKey = apiKey;
    this.model = model;
  }

  async embed(text: string): Promise<number[]> {
    const [result] = await this.embedBatch([text]);
    return result;
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    const results: number[][] = [];
    const processed = texts.map(preprocessText);

    // Voyage supports up to 128 texts per request
    for (let i = 0; i < processed.length; i += 128) {
      const batch = processed.slice(i, i + 128);
      const resp = await fetch("https://api.voyageai.com/v1/embeddings", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: this.model,
          input: batch,
          input_type: "document",
        }),
      });

      if (!resp.ok) {
        const err = await resp.text();
        throw new Error(`Voyage AI embeddings API error ${resp.status}: ${err}`);
      }

      const data = await resp.json();
      const sorted = data.data.sort((a: any, b: any) => a.index - b.index);
      for (const item of sorted) {
        results.push(item.embedding);
      }
    }

    return results;
  }
}

// --- Factory ---

export interface EmbeddingConfig {
  provider: "local" | "openai" | "voyage";
  apiKey?: string;
  voyageModel?: string;
}

export function createEmbeddingProvider(config: EmbeddingConfig): EmbeddingProvider {
  if (config.provider === "openai") {
    if (!config.apiKey) throw new Error("OpenAI API key required for openai embedding provider");
    return new OpenAIEmbeddingProvider(config.apiKey);
  }
  if (config.provider === "voyage") {
    if (!config.apiKey) throw new Error("Voyage AI API key required for voyage embedding provider");
    return new VoyageEmbeddingProvider(config.apiKey, config.voyageModel);
  }
  return new LocalEmbeddingProvider();
}
