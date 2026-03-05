import { describe, it, expect, vi, beforeEach } from "vitest";
import { createEmbeddingProvider, preprocessText } from "../../src/lib/embeddings.js";

describe("preprocessText", () => {
  it("strips markdown formatting", () => {
    const result = preprocessText("# Hello **world** `code` [link](http://x.com)");
    expect(result).not.toContain("#");
    expect(result).not.toContain("**");
    expect(result).not.toContain("`");
    expect(result).toContain("link");
  });

  it("truncates long text to 2048 chars", () => {
    const long = "a".repeat(5000);
    expect(preprocessText(long).length).toBe(2048);
  });
});

describe("createEmbeddingProvider", () => {
  it("creates local provider by default", () => {
    const provider = createEmbeddingProvider({ provider: "local" });
    expect(provider.dimensions).toBe(384);
  });

  it("creates openai provider with api key", () => {
    const provider = createEmbeddingProvider({ provider: "openai", apiKey: "sk-test" });
    expect(provider.dimensions).toBe(1536);
  });

  it("throws when openai provider missing api key", () => {
    expect(() => createEmbeddingProvider({ provider: "openai" })).toThrow("OpenAI API key required");
  });

  it("creates ollama provider with defaults", () => {
    const provider = createEmbeddingProvider({ provider: "ollama" });
    expect(provider.dimensions).toBe(768);
  });

  it("creates ollama provider with custom config", () => {
    const provider = createEmbeddingProvider({
      provider: "ollama",
      ollamaBaseUrl: "http://myhost:11434",
      ollamaModel: "mxbai-embed-large",
      ollamaDimensions: 1024,
    });
    expect(provider.dimensions).toBe(1024);
  });
});
