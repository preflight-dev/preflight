import { describe, it, expect, vi } from "vitest";
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

  it("returns ollama provider with default 384 dimensions", () => {
    const provider = createEmbeddingProvider({ provider: "ollama" });
    expect(provider.dimensions).toBe(384);
  });

  it("returns ollama provider with custom base URL and model", () => {
    const provider = createEmbeddingProvider({
      provider: "ollama",
      ollamaBaseUrl: "http://myhost:11434",
      ollamaModel: "nomic-embed-text",
    });
    expect(provider.dimensions).toBe(384);
    expect(provider).toBeDefined();
  });
});

describe("OllamaEmbeddingProvider", () => {
  it("calls /api/embed and resolves dimensions from response", async () => {
    const fakeEmbedding = Array.from({ length: 768 }, (_, i) => i * 0.001);
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ embeddings: [fakeEmbedding] }),
    });
    vi.stubGlobal("fetch", mockFetch);

    const provider = createEmbeddingProvider({
      provider: "ollama",
      ollamaBaseUrl: "http://localhost:11434",
      ollamaModel: "nomic-embed-text",
    });

    const result = await provider.embed("test text");
    expect(result).toHaveLength(768);
    expect(provider.dimensions).toBe(768);
    expect(mockFetch).toHaveBeenCalledWith(
      "http://localhost:11434/api/embed",
      expect.objectContaining({ method: "POST" }),
    );

    vi.unstubAllGlobals();
  });

  it("handles batch embedding via /api/embed", async () => {
    const fakeEmbeddings = [
      Array.from({ length: 384 }, () => 0.1),
      Array.from({ length: 384 }, () => 0.2),
    ];
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ embeddings: fakeEmbeddings }),
    });
    vi.stubGlobal("fetch", mockFetch);

    const provider = createEmbeddingProvider({ provider: "ollama" });
    const results = await provider.embedBatch(["hello", "world"]);
    expect(results).toHaveLength(2);
    expect(results[0][0]).toBeCloseTo(0.1);
    expect(results[1][0]).toBeCloseTo(0.2);

    vi.unstubAllGlobals();
  });

  it("throws on Ollama API error", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      text: async () => "model not found",
    });
    vi.stubGlobal("fetch", mockFetch);

    const provider = createEmbeddingProvider({ provider: "ollama" });
    await expect(provider.embed("test")).rejects.toThrow("Ollama embeddings error 404");

    vi.unstubAllGlobals();
  });

  it("strips trailing slashes from base URL", async () => {
    const fakeEmbedding = Array.from({ length: 384 }, () => 0);
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ embeddings: [fakeEmbedding] }),
    });
    vi.stubGlobal("fetch", mockFetch);

    const provider = createEmbeddingProvider({
      provider: "ollama",
      ollamaBaseUrl: "http://localhost:11434///",
    });
    await provider.embed("test");
    expect(mockFetch).toHaveBeenCalledWith(
      "http://localhost:11434/api/embed",
      expect.anything(),
    );

    vi.unstubAllGlobals();
  });
});
