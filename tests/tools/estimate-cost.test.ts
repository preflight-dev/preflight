import { describe, it, expect, vi, beforeEach } from "vitest";
import { writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// Mock session-parser
vi.mock("../../src/lib/session-parser.js", () => ({
  findSessionDirs: vi.fn().mockReturnValue([]),
  findSessionFiles: vi.fn().mockReturnValue([]),
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

describe("estimate_cost", () => {
  let server: ReturnType<typeof createMockServer>;
  let tmpDir: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    server = createMockServer();
    tmpDir = join(tmpdir(), `preflight-test-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });
    const mod = await import("../../src/tools/estimate-cost.js");
    mod.registerEstimateCost(server as any);
  });

  afterEach(() => {
    try { rmSync(tmpDir, { recursive: true }); } catch {}
  });

  it("registers the estimate_cost tool", () => {
    expect(server.tools["estimate_cost"]).toBeDefined();
    expect(server.tools["estimate_cost"].description).toContain("cost");
  });

  it("reports file not found for bad path", async () => {
    const result = await server.tools["estimate_cost"].handler({
      session_dir: "/nonexistent/path.jsonl",
    });
    expect(result.content[0].text).toContain("not found");
  });

  it("analyzes a simple session file", async () => {
    const sessionFile = join(tmpDir, "session.jsonl");
    const lines = [
      JSON.stringify({ type: "user", timestamp: "2026-03-15T10:00:00Z", message: { content: "fix the bug in auth.ts" } }),
      JSON.stringify({ type: "assistant", timestamp: "2026-03-15T10:01:00Z", message: { content: [{ type: "text", text: "I'll fix that bug now." }] } }),
      JSON.stringify({ type: "user", timestamp: "2026-03-15T10:02:00Z", message: { content: "no, wrong file" } }),
      JSON.stringify({ type: "assistant", timestamp: "2026-03-15T10:03:00Z", message: { content: [{ type: "text", text: "Sorry, let me check the right file." }] } }),
    ];
    writeFileSync(sessionFile, lines.join("\n"));

    const result = await server.tools["estimate_cost"].handler({
      session_dir: sessionFile,
      model: "claude-sonnet-4",
    });

    const text = result.content[0].text;
    expect(text).toContain("Session Cost Estimate");
    expect(text).toContain("2 prompts");
    expect(text).toContain("Corrections detected: 1");
  });

  it("detects zero corrections in clean session", async () => {
    const sessionFile = join(tmpDir, "clean.jsonl");
    const lines = [
      JSON.stringify({ type: "user", timestamp: "2026-03-15T10:00:00Z", message: { content: "add a test for utils.ts" } }),
      JSON.stringify({ type: "assistant", timestamp: "2026-03-15T10:01:00Z", message: { content: [{ type: "text", text: "Done, test added." }] } }),
    ];
    writeFileSync(sessionFile, lines.join("\n"));

    const result = await server.tools["estimate_cost"].handler({
      session_dir: sessionFile,
    });

    expect(result.content[0].text).toContain("No corrections detected");
  });

  it("counts preflight tool calls", async () => {
    const sessionFile = join(tmpDir, "preflight.jsonl");
    const lines = [
      JSON.stringify({ type: "user", timestamp: "2026-03-15T10:00:00Z", message: { content: "check my prompt" } }),
      JSON.stringify({
        type: "assistant",
        timestamp: "2026-03-15T10:01:00Z",
        message: {
          content: [
            { type: "tool_use", name: "preflight_check", id: "t1", input: { prompt: "test" } },
          ],
        },
      }),
      JSON.stringify({ type: "tool_result", tool_use_id: "t1", content: "looks good" }),
    ];
    writeFileSync(sessionFile, lines.join("\n"));

    const result = await server.tools["estimate_cost"].handler({
      session_dir: sessionFile,
    });

    const text = result.content[0].text;
    expect(text).toContain("Preflight checks: 1");
  });

  it("uses correct pricing for different models", async () => {
    const sessionFile = join(tmpDir, "model.jsonl");
    const bigText = "x".repeat(4000); // ~1000 tokens
    const lines = [
      JSON.stringify({ type: "user", timestamp: "2026-03-15T10:00:00Z", message: { content: bigText } }),
      JSON.stringify({ type: "assistant", timestamp: "2026-03-15T10:01:00Z", message: { content: [{ type: "text", text: bigText }] } }),
    ];
    writeFileSync(sessionFile, lines.join("\n"));

    const sonnetResult = await server.tools["estimate_cost"].handler({
      session_dir: sessionFile,
      model: "claude-sonnet-4",
    });
    const opusResult = await server.tools["estimate_cost"].handler({
      session_dir: sessionFile,
      model: "claude-opus-4",
    });

    // Opus should show higher cost
    expect(opusResult.content[0].text).toContain("Claude Opus 4");
    expect(sonnetResult.content[0].text).toContain("Claude Sonnet 4");
  });
});

// Need afterEach import
import { afterEach } from "vitest";
