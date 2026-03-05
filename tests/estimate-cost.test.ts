import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock dependencies before importing
vi.mock("node:fs", () => ({
  readFileSync: vi.fn(),
  statSync: vi.fn(),
}));

vi.mock("../src/lib/session-parser.js", () => ({
  findSessionDirs: vi.fn(),
  findSessionFiles: vi.fn(),
}));

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { readFileSync, statSync } from "node:fs";
import { findSessionDirs, findSessionFiles } from "../src/lib/session-parser.js";
import { registerEstimateCost } from "../src/tools/estimate-cost.js";

describe("estimate_cost", () => {
  let handler: any;

  beforeEach(() => {
    vi.clearAllMocks();
    const server = {
      tool: vi.fn((_name: string, _desc: string, _schema: any, h: any) => {
        handler = h;
      }),
    } as any;
    registerEstimateCost(server);
  });

  it("registers the tool", () => {
    expect(handler).toBeDefined();
  });

  it("returns error when no session files found", async () => {
    vi.mocked(findSessionDirs).mockReturnValue([]);
    const result = await handler({});
    expect(result.content[0].text).toContain("No session files found");
  });

  it("returns error for missing file path", async () => {
    vi.mocked(statSync).mockImplementation(() => {
      throw new Error("ENOENT");
    });
    const result = await handler({ session_dir: "/nonexistent/file.jsonl" });
    expect(result.content[0].text).toContain("Session file not found");
  });

  it("analyzes a simple session with no corrections", async () => {
    const sessionData = [
      JSON.stringify({
        type: "user",
        timestamp: "2026-01-01T10:00:00Z",
        message: { content: "Hello, write me a function" },
      }),
      JSON.stringify({
        type: "assistant",
        timestamp: "2026-01-01T10:00:05Z",
        message: {
          content: [{ type: "text", text: "Here is a function that does what you need:\n```\nfunction add(a, b) { return a + b; }\n```" }],
        },
      }),
    ].join("\n");

    vi.mocked(statSync).mockReturnValue({} as any);
    vi.mocked(readFileSync).mockReturnValue(sessionData);

    const result = await handler({ session_dir: "/tmp/test.jsonl" });
    const text = result.content[0].text;

    expect(text).toContain("Session Cost Estimate");
    expect(text).toContain("1 prompts");
    expect(text).toContain("No corrections detected");
  });

  it("detects corrections from user signals", async () => {
    const sessionData = [
      JSON.stringify({
        type: "user",
        timestamp: "2026-01-01T10:00:00Z",
        message: { content: "Write a sorting function" },
      }),
      JSON.stringify({
        type: "assistant",
        timestamp: "2026-01-01T10:00:05Z",
        message: {
          content: [{ type: "text", text: "Here is bubble sort: " + "x".repeat(400) }],
        },
      }),
      JSON.stringify({
        type: "user",
        timestamp: "2026-01-01T10:00:10Z",
        message: { content: "No, I meant quicksort, not that" },
      }),
      JSON.stringify({
        type: "assistant",
        timestamp: "2026-01-01T10:00:15Z",
        message: {
          content: [{ type: "text", text: "Here is quicksort: " + "y".repeat(400) }],
        },
      }),
    ].join("\n");

    vi.mocked(statSync).mockReturnValue({} as any);
    vi.mocked(readFileSync).mockReturnValue(sessionData);

    const result = await handler({ session_dir: "/tmp/test.jsonl" });
    const text = result.content[0].text;

    expect(text).toContain("Corrections detected: 1");
    expect(text).toContain("Waste Analysis");
  });

  it("detects preflight tool calls", async () => {
    const sessionData = [
      JSON.stringify({
        type: "user",
        timestamp: "2026-01-01T10:00:00Z",
        message: { content: "Check my prompt" },
      }),
      JSON.stringify({
        type: "assistant",
        timestamp: "2026-01-01T10:00:05Z",
        message: {
          content: [
            { type: "tool_use", name: "preflight_check", input: { prompt: "test" } },
            { type: "text", text: "Running preflight check..." },
          ],
        },
      }),
    ].join("\n");

    vi.mocked(statSync).mockReturnValue({} as any);
    vi.mocked(readFileSync).mockReturnValue(sessionData);

    const result = await handler({ session_dir: "/tmp/test.jsonl" });
    const text = result.content[0].text;

    expect(text).toContain("Preflight checks: 1");
  });

  it("uses specified pricing model", async () => {
    const sessionData = [
      JSON.stringify({
        type: "user",
        timestamp: "2026-01-01T10:00:00Z",
        message: { content: "x".repeat(4000) }, // ~1000 tokens
      }),
      JSON.stringify({
        type: "assistant",
        timestamp: "2026-01-01T10:01:00Z",
        message: {
          content: [{ type: "text", text: "y".repeat(4000) }], // ~1000 tokens
        },
      }),
    ].join("\n");

    vi.mocked(statSync).mockReturnValue({} as any);
    vi.mocked(readFileSync).mockReturnValue(sessionData);

    const result = await handler({ session_dir: "/tmp/test.jsonl", model: "claude-opus-4" });
    const text = result.content[0].text;

    expect(text).toContain("Claude Opus 4");
  });

  it("finds latest session file when no path given", async () => {
    vi.mocked(findSessionDirs).mockReturnValue([
      { sessionDir: "/home/user/.claude/projects/test", projectDir: "/test" },
    ]);
    vi.mocked(findSessionFiles).mockReturnValue([
      { path: "/home/user/.claude/projects/test/session.jsonl", mtime: new Date("2026-01-01") },
    ]);
    vi.mocked(statSync).mockReturnValue({} as any);
    vi.mocked(readFileSync).mockReturnValue(
      JSON.stringify({
        type: "user",
        timestamp: "2026-01-01T10:00:00Z",
        message: { content: "hello" },
      }),
    );

    const result = await handler({});
    expect(result.content[0].text).toContain("Session Cost Estimate");
  });

  it("handles malformed JSONL lines gracefully", async () => {
    const sessionData = [
      "not valid json",
      JSON.stringify({
        type: "user",
        timestamp: "2026-01-01T10:00:00Z",
        message: { content: "hello" },
      }),
      "{broken",
    ].join("\n");

    vi.mocked(statSync).mockReturnValue({} as any);
    vi.mocked(readFileSync).mockReturnValue(sessionData);

    const result = await handler({ session_dir: "/tmp/test.jsonl" });
    const text = result.content[0].text;

    expect(text).toContain("Session Cost Estimate");
    expect(text).toContain("1 prompts");
  });
});
