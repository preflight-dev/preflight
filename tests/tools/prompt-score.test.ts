import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock fs to avoid writing state files during tests
vi.mock("node:fs/promises", () => ({
  readFile: vi.fn().mockRejectedValue(new Error("no file")),
  writeFile: vi.fn().mockResolvedValue(undefined),
  mkdir: vi.fn().mockResolvedValue(undefined),
}));

function createMockServer() {
  const tools: Record<string, { handler: Function; description: string }> = {};
  return {
    tool(name: string, description: string, _schema: any, handler: Function) {
      tools[name] = { handler, description };
    },
    tools,
  };
}

describe("prompt_score", () => {
  let server: ReturnType<typeof createMockServer>;

  beforeEach(async () => {
    vi.clearAllMocks();
    server = createMockServer();
    const mod = await import("../../src/tools/prompt-score.js");
    mod.registerPromptScore(server as any);
  });

  it("registers the prompt_score tool", () => {
    expect(server.tools["prompt_score"]).toBeDefined();
    expect(server.tools["prompt_score"].description).toContain("Score");
  });

  it("gives high score to a specific, actionable prompt", async () => {
    const result = await server.tools["prompt_score"].handler({
      prompt: "Rename the `fetchUser` function in `src/api/users.ts` to `getUserById`. Only this one function should change. The existing tests must still pass.",
    });

    const text = result.content[0].text;
    // Should score well on all dimensions
    expect(text).toMatch(/Specificity:\s+25\/25/);
    expect(text).toMatch(/Actionability:\s+25\/25/);
    expect(text).toMatch(/Done condition:\s+25\/25/);
    // Grade should be good
    expect(text).toMatch(/[AB][+-]?\s/);
  });

  it("gives low score to a vague prompt", async () => {
    const result = await server.tools["prompt_score"].handler({
      prompt: "make it better",
    });

    const text = result.content[0].text;
    expect(text).toMatch(/[DF]/); // Low grade
    expect(text).toContain("specific"); // Should have feedback about specificity
  });

  it("recognizes action verbs", async () => {
    const result = await server.tools["prompt_score"].handler({
      prompt: "refactor the auth module",
    });
    const text = result.content[0].text;
    expect(text).toMatch(/Actionability:\s+25\/25/);
  });

  it("penalizes vague verbs", async () => {
    const result = await server.tools["prompt_score"].handler({
      prompt: "clean up the code",
    });
    const text = result.content[0].text;
    expect(text).toMatch(/Actionability:\s+15\/25/);
    expect(text).toContain("Vague verb");
  });

  it("rewards file paths for specificity", async () => {
    const result = await server.tools["prompt_score"].handler({
      prompt: "do something to src/index.ts",
    });
    const text = result.content[0].text;
    expect(text).toMatch(/Specificity:\s+25\/25/);
  });

  it("recognizes questions as having done conditions", async () => {
    const result = await server.tools["prompt_score"].handler({
      prompt: "What does the auth middleware do?",
    });
    const text = result.content[0].text;
    expect(text).toMatch(/Done condition:\s+20\/25/);
  });

  it("tracks session average", async () => {
    await server.tools["prompt_score"].handler({ prompt: "fix bug" });
    const result = await server.tools["prompt_score"].handler({ prompt: "add test" });
    const text = result.content[0].text;
    expect(text).toContain("prompts scored");
  });
});
