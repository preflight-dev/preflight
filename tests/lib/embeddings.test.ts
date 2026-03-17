import { describe, it, expect } from "vitest";
import { preprocessText, createEmbeddingProvider } from "../../src/lib/embeddings.js";

describe("preprocessText", () => {
  it("strips code blocks", () => {
    const result = preprocessText("before ```const x = 1;``` after");
    expect(result).not.toContain("const x");
    expect(result).toContain("before");
    expect(result).toContain("after");
  });

  it("strips inline code", () => {
    const result = preprocessText("use `foo()` here");
    expect(result).not.toContain("foo()");
    expect(result).toContain("use");
    expect(result).toContain("here");
  });

  it("removes markdown characters", () => {
    const result = preprocessText("# Heading **bold** _italic_");
    expect(result).not.toContain("#");
    expect(result).not.toContain("**");
  });

  it("strips markdown link brackets and parens", () => {
    const result = preprocessText("[Click here](https://example.com)");
    // Brackets and parens are removed by markdown char stripping
    expect(result).not.toContain("[");
    expect(result).not.toContain("]");
    expect(result).not.toContain("(");
    expect(result).not.toContain(")");
    expect(result).toContain("Click here");
  });

  it("normalizes whitespace", () => {
    const result = preprocessText("hello   \n\n   world");
    expect(result).toBe("hello world");
  });

  it("truncates to 2048 chars", () => {
    const long = "a".repeat(3000);
    const result = preprocessText(long);
    expect(result.length).toBeLessThanOrEqual(2048);
  });
});

describe("createEmbeddingProvider", () => {
  it("returns local provider with 384 dimensions", () => {
    const provider = createEmbeddingProvider({ provider: "local" });
    expect(provider.dimensions).toBe(384);
  });

  it("throws when openai provider has no API key", () => {
    expect(() =>
      createEmbeddingProvider({ provider: "openai" }),
    ).toThrow("API key required");
  });

  it("returns openai provider with 1536 dimensions when key provided", () => {
    const provider = createEmbeddingProvider({
      provider: "openai",
      apiKey: "sk-test-key",
    });
    expect(provider.dimensions).toBe(1536);
  });

  it("returns ollama provider with default 768 dimensions", () => {
    const provider = createEmbeddingProvider({ provider: "ollama" });
    expect(provider.dimensions).toBe(768);
  });

  it("returns ollama provider with custom dimensions", () => {
    const provider = createEmbeddingProvider({
      provider: "ollama",
      ollamaDimensions: 1024,
    });
    expect(provider.dimensions).toBe(1024);
  });

  it("accepts custom ollama model and base URL", () => {
    const provider = createEmbeddingProvider({
      provider: "ollama",
      ollamaBaseUrl: "http://my-server:11434",
      ollamaModel: "mxbai-embed-large",
      ollamaDimensions: 1024,
    });
    expect(provider.dimensions).toBe(1024);
  });
});
