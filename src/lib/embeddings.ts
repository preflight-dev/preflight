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

// --- Ollama Provider ---

class OllamaEmbeddingProvider implements EmbeddingProvider {
  dimensions: number;
  private baseUrl: string;
  private model: string;

  constructor(options?: { baseUrl?: string; model?: string; dimensions?: number }) {
    this.baseUrl = options?.baseUrl ?? "http://localhost:11434";
    this.model = options?.model ?? "nomic-embed-text";
    // nomic-embed-text produces 768-dim vectors; allow override for other models
    this.dimensions = options?.dimensions ?? 768;
  }

  async embed(text: string): Promise<number[]> {
    const processed = preprocessText(text);
    const resp = await fetch(`${this.baseUrl}/api/embed`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: this.model, input: processed }),
    });

    if (!resp.ok) {
      const err = await resp.text();
      throw new Error(`Ollama embeddings API error ${resp.status}: ${err}`);
    }

    const data = await resp.json();
    // /api/embed returns { embeddings: number[][] }
    if (!data.embeddings?.[0]) {
      throw new Error("Ollama returned no embeddings");
    }
    return data.embeddings[0];
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    // Ollama /api/embed supports multiple inputs natively
    const processed = texts.map(preprocessText);
    const resp = await fetch(`${this.baseUrl}/api/embed`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: this.model, input: processed }),
    });

    if (!resp.ok) {
      const err = await resp.text();
      throw new Error(`Ollama embeddings API error ${resp.status}: ${err}`);
    }

    const data = await resp.json();
    if (!data.embeddings || data.embeddings.length !== texts.length) {
      throw new Error(`Ollama returned ${data.embeddings?.length ?? 0} embeddings, expected ${texts.length}`);
    }
    return data.embeddings;
  }
}

// --- Factory ---

export interface EmbeddingConfig {
  provider: "local" | "openai" | "ollama";
  apiKey?: string;
  ollamaBaseUrl?: string;
  ollamaModel?: string;
  ollamaDimensions?: number;
}

export function createEmbeddingProvider(config: EmbeddingConfig): EmbeddingProvider {
  if (config.provider === "openai") {
    if (!config.apiKey) throw new Error("OpenAI API key required for openai embedding provider");
    return new OpenAIEmbeddingProvider(config.apiKey);
  }
  if (config.provider === "ollama") {
    return new OllamaEmbeddingProvider({
      baseUrl: config.ollamaBaseUrl,
      model: config.ollamaModel,
      dimensions: config.ollamaDimensions,
    });
  }
  return new LocalEmbeddingProvider();
}
