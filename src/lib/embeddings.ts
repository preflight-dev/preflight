// =============================================================================
// Embedding Providers for Preflight Timeline Search
// =============================================================================
// Converts text (prompts, commits, corrections) into dense vectors for
// semantic similarity search in LanceDB. Two providers are supported:
//
//   1. **Local** (default) — Xenova/all-MiniLM-L6-v2 (384-dim, ~90MB download
//      on first use, runs entirely on-device, no API key needed)
//   2. **OpenAI** — text-embedding-3-small (1536-dim, requires OPENAI_API_KEY,
//      batches up to 100 texts per request)
//
// Text is preprocessed before embedding: markdown is stripped, whitespace is
// normalized, and content is truncated to ~2048 chars (~512 tokens) to stay
// within model context limits.
//
// Usage:
//   const provider = createEmbeddingProvider({ provider: "local" });
//   const vector = await provider.embed("fix the auth bug");
//   const vectors = await provider.embedBatch(["text1", "text2"]);
// =============================================================================

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

// --- Factory ---

export interface EmbeddingConfig {
  provider: "local" | "openai";
  apiKey?: string;
}

export function createEmbeddingProvider(config: EmbeddingConfig): EmbeddingProvider {
  if (config.provider === "openai") {
    if (!config.apiKey) throw new Error("OpenAI API key required for openai embedding provider");
    return new OpenAIEmbeddingProvider(config.apiKey);
  }
  return new LocalEmbeddingProvider();
}
