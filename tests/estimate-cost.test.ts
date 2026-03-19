import { describe, it, expect, vi, beforeEach } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerEstimateCost } from "../src/tools/estimate-cost.js";
import { writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// Mock session-parser to avoid reading real ~/.claude
vi.mock("../src/lib/session-parser.js", () => ({
  findSessionDirs: vi.fn().mockReturnValue([]),
  findSessionFiles: vi.fn().mockReturnValue([]),
}));

// ── Helpers ─────────────────────────────────────────────────────────────────

const TEST_DIR = join(tmpdir(), "preflight-estimate-cost-test");

function makeSessionFile(messages: any[]): string {
  mkdirSync(TEST_DIR, { recursive: true });
  const filePath = join(TEST_DIR, "session.jsonl");
  const lines = messages.map((m) => JSON.stringify(m)).join("\n");
  writeFileSync(filePath, lines, "utf-8");
  return filePath;
}

function captureToolHandler(register: (server: McpServer) => void): any {
  let handler: any;
  const server = new McpServer({ name: "test", version: "1.0.0" });
  const originalTool = server.tool.bind(server);
  server.tool = ((...args: any[]) => {
    handler = args[args.length - 1];
    return originalTool(...args);
  }) as any;
  register(server);
  return handler;
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe("estimate_cost", () => {
  let toolHandler: any;

  beforeEach(() => {
    toolHandler = captureToolHandler(registerEstimateCost);
  });

  afterAll(() => {
    try { rmSync(TEST_DIR, { recursive: true, force: true }); } catch {}
  });

  it("reports token usage for a simple session", async () => {
    const filePath = makeSessionFile([
      {
        type: "user",
        timestamp: "2026-03-19T10:00:00Z",
        message: { content: "Write a hello world function" },
      },
      {
        type: "assistant",
        timestamp: "2026-03-19T10:00:05Z",
        message: {
          content: [
            { type: "text", text: "Here is a hello world function:\n\nfunction hello() {\n  console.log('Hello, world!');\n}" },
          ],
        },
      },
    ]);

    const result = await toolHandler({ session_dir: filePath });
    const text = result.content[0].text;

    expect(text).toContain("Session Cost Estimate");
    expect(text).toContain("1 prompts");
    expect(text).toContain("Input:");
    expect(text).toContain("Output:");
    expect(text).toContain("Estimated Cost:");
    expect(text).toContain("No corrections detected");
  });

  it("detects corrections from vague prompts", async () => {
    const filePath = makeSessionFile([
      {
        type: "user",
        timestamp: "2026-03-19T10:00:00Z",
        message: { content: "Make a function" },
      },
      {
        type: "assistant",
        timestamp: "2026-03-19T10:00:05Z",
        message: {
          content: [
            { type: "text", text: "Here is a generic function that processes data and returns results for you to use in your application." },
          ],
        },
      },
      {
        type: "user",
        timestamp: "2026-03-19T10:00:30Z",
        message: { content: "No, wrong. I meant a sorting function" },
      },
      {
        type: "assistant",
        timestamp: "2026-03-19T10:00:35Z",
        message: {
          content: [
            { type: "text", text: "Here is a sorting function that uses quicksort." },
          ],
        },
      },
    ]);

    const result = await toolHandler({ session_dir: filePath });
    const text = result.content[0].text;

    expect(text).toContain("Corrections detected: 1");
    expect(text).toContain("Wasted output tokens:");
  });

  it("counts preflight tool calls", async () => {
    const filePath = makeSessionFile([
      {
        type: "user",
        timestamp: "2026-03-19T10:00:00Z",
        message: { content: "Check my prompt quality" },
      },
      {
        type: "assistant",
        timestamp: "2026-03-19T10:00:05Z",
        message: {
          content: [
            {
              type: "tool_use",
              id: "tu_1",
              name: "preflight_check",
              input: { prompt: "Check my prompt quality" },
            },
            { type: "text", text: "Running preflight check..." },
          ],
        },
      },
      {
        type: "tool_result",
        tool_use_id: "tu_1",
        content: "Preflight check passed",
      },
    ]);

    const result = await toolHandler({ session_dir: filePath });
    const text = result.content[0].text;

    expect(text).toContain("Preflight checks: 1");
    expect(text).toContain("Preflight cost:");
  });

  it("handles missing session file gracefully", async () => {
    const result = await toolHandler({
      session_dir: "/nonexistent/path/session.jsonl",
    });
    const text = result.content[0].text;
    expect(text).toContain("Session file not found");
  });

  it("handles no session files when no path given", async () => {
    const result = await toolHandler({});
    const text = result.content[0].text;
    expect(text).toContain("No session files found");
  });

  it("uses specified pricing model", async () => {
    const filePath = makeSessionFile([
      {
        type: "user",
        timestamp: "2026-03-19T10:00:00Z",
        message: { content: "Hello" },
      },
      {
        type: "assistant",
        timestamp: "2026-03-19T10:00:01Z",
        message: { content: [{ type: "text", text: "Hi there!" }] },
      },
    ]);

    const result = await toolHandler({
      session_dir: filePath,
      model: "claude-opus-4",
    });
    const text = result.content[0].text;
    expect(text).toContain("Claude Opus 4");
  });
});
