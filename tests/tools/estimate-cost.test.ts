import { describe, it, expect } from "vitest";
import { writeFileSync, mkdirSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
  estimateTokens,
  extractText,
  extractToolNames,
  formatTokens,
  formatCost,
  formatDuration,
  analyzeSessionFile,
} from "../../src/tools/estimate-cost.js";

// ── estimateTokens ──────────────────────────────────────────────────────────

describe("estimateTokens", () => {
  it("returns ~1 token per 4 chars", () => {
    expect(estimateTokens("abcd")).toBe(1);
    expect(estimateTokens("abcde")).toBe(2); // ceil(5/4)
  });

  it("handles empty string", () => {
    expect(estimateTokens("")).toBe(0);
  });

  it("handles long text", () => {
    const text = "x".repeat(1000);
    expect(estimateTokens(text)).toBe(250);
  });
});

// ── extractText ─────────────────────────────────────────────────────────────

describe("extractText", () => {
  it("returns string content as-is", () => {
    expect(extractText("hello world")).toBe("hello world");
  });

  it("extracts text from content block array", () => {
    const blocks = [
      { type: "text", text: "first" },
      { type: "text", text: "second" },
    ];
    expect(extractText(blocks)).toBe("first\nsecond");
  });

  it("skips non-text blocks", () => {
    const blocks = [
      { type: "text", text: "keep" },
      { type: "tool_use", name: "read", input: {} },
      { type: "text", text: "also keep" },
    ];
    expect(extractText(blocks)).toBe("keep\nalso keep");
  });

  it("returns empty string for null/undefined", () => {
    expect(extractText(null)).toBe("");
    expect(extractText(undefined)).toBe("");
  });

  it("returns empty string for number", () => {
    expect(extractText(42)).toBe("");
  });

  it("returns empty string for object", () => {
    expect(extractText({ foo: "bar" })).toBe("");
  });

  it("handles empty array", () => {
    expect(extractText([])).toBe("");
  });
});

// ── extractToolNames ────────────────────────────────────────────────────────

describe("extractToolNames", () => {
  it("extracts tool names from content blocks", () => {
    const blocks = [
      { type: "text", text: "I'll read the file" },
      { type: "tool_use", name: "Read", input: { path: "foo.ts" } },
      { type: "tool_use", name: "Edit", input: { path: "bar.ts" } },
    ];
    expect(extractToolNames(blocks)).toEqual(["Read", "Edit"]);
  });

  it("returns empty for non-array", () => {
    expect(extractToolNames("string")).toEqual([]);
    expect(extractToolNames(null)).toEqual([]);
    expect(extractToolNames(42)).toEqual([]);
  });

  it("skips blocks without name", () => {
    const blocks = [
      { type: "tool_use" },
      { type: "tool_use", name: "Read", input: {} },
    ];
    expect(extractToolNames(blocks)).toEqual(["Read"]);
  });

  it("handles empty array", () => {
    expect(extractToolNames([])).toEqual([]);
  });
});

// ── formatTokens ────────────────────────────────────────────────────────────

describe("formatTokens", () => {
  it("formats small numbers as-is", () => {
    expect(formatTokens(500)).toBe("500");
  });

  it("formats thousands as k", () => {
    expect(formatTokens(1000)).toBe("1.0k");
    expect(formatTokens(15_500)).toBe("15.5k");
  });

  it("formats millions as M", () => {
    expect(formatTokens(1_000_000)).toBe("1.0M");
    expect(formatTokens(2_500_000)).toBe("2.5M");
  });

  it("formats zero", () => {
    expect(formatTokens(0)).toBe("0");
  });
});

// ── formatCost ──────────────────────────────────────────────────────────────

describe("formatCost", () => {
  it("formats normal costs", () => {
    expect(formatCost(1.5)).toBe("$1.50");
    expect(formatCost(0.05)).toBe("$0.05");
  });

  it("formats very small costs", () => {
    expect(formatCost(0.001)).toBe("<$0.01");
    expect(formatCost(0.009)).toBe("<$0.01");
  });

  it("formats zero", () => {
    expect(formatCost(0)).toBe("<$0.01");
  });
});

// ── formatDuration ──────────────────────────────────────────────────────────

describe("formatDuration", () => {
  it("formats minutes", () => {
    expect(formatDuration(5 * 60_000)).toBe("5m");
    expect(formatDuration(45 * 60_000)).toBe("45m");
  });

  it("formats hours and minutes", () => {
    expect(formatDuration(90 * 60_000)).toBe("1h 30m");
    expect(formatDuration(125 * 60_000)).toBe("2h 5m");
  });

  it("formats zero", () => {
    expect(formatDuration(0)).toBe("0m");
  });
});

// ── analyzeSessionFile ──────────────────────────────────────────────────────

describe("analyzeSessionFile", () => {
  const tmpDir = join(tmpdir(), "preflight-test-estimate-cost");

  function writeSession(name: string, lines: object[]): string {
    mkdirSync(tmpDir, { recursive: true });
    const path = join(tmpDir, name);
    writeFileSync(path, lines.map((l) => JSON.stringify(l)).join("\n"));
    return path;
  }

  afterAll(() => {
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  });

  it("counts user prompts and assistant responses", () => {
    const path = writeSession("basic.jsonl", [
      { type: "user", timestamp: "2025-01-01T00:00:00Z", message: { content: "hello world" } },
      { type: "assistant", timestamp: "2025-01-01T00:01:00Z", message: { content: "hi there, how can I help?" } },
      { type: "user", timestamp: "2025-01-01T00:02:00Z", message: { content: "do something" } },
      { type: "assistant", timestamp: "2025-01-01T00:03:00Z", message: { content: "done!" } },
    ]);
    const result = analyzeSessionFile(path);
    expect(result.promptCount).toBe(2);
    expect(result.inputTokens).toBeGreaterThan(0);
    expect(result.outputTokens).toBeGreaterThan(0);
  });

  it("detects corrections", () => {
    const path = writeSession("corrections.jsonl", [
      { type: "user", timestamp: "2025-01-01T00:00:00Z", message: { content: "add a button" } },
      { type: "assistant", timestamp: "2025-01-01T00:01:00Z", message: { content: "I added a red button to the header component." } },
      { type: "user", timestamp: "2025-01-01T00:02:00Z", message: { content: "no, wrong file. I meant the footer." } },
    ]);
    const result = analyzeSessionFile(path);
    expect(result.corrections).toBe(1);
    expect(result.wastedOutputTokens).toBeGreaterThan(0);
  });

  it("counts tool calls", () => {
    const path = writeSession("tools.jsonl", [
      { type: "user", timestamp: "2025-01-01T00:00:00Z", message: { content: "read the file" } },
      {
        type: "assistant",
        timestamp: "2025-01-01T00:01:00Z",
        message: {
          content: [
            { type: "text", text: "I'll read the file." },
            { type: "tool_use", name: "Read", id: "t1", input: { path: "foo.ts" } },
          ],
        },
      },
      { type: "tool_result", tool_use_id: "t1", content: "file contents here" },
    ]);
    const result = analyzeSessionFile(path);
    expect(result.toolCallCount).toBe(1);
  });

  it("detects preflight tool calls", () => {
    const path = writeSession("preflight.jsonl", [
      { type: "user", timestamp: "2025-01-01T00:00:00Z", message: { content: "check my code" } },
      {
        type: "assistant",
        timestamp: "2025-01-01T00:01:00Z",
        message: {
          content: [
            { type: "text", text: "Running preflight check." },
            { type: "tool_use", name: "preflight_check", id: "t1", input: { task: "review code" } },
          ],
        },
      },
    ]);
    const result = analyzeSessionFile(path);
    expect(result.preflightCalls).toBe(1);
    expect(result.preflightTokens).toBeGreaterThan(0);
  });

  it("tracks timestamps", () => {
    const path = writeSession("timestamps.jsonl", [
      { type: "user", timestamp: "2025-01-01T10:00:00Z", message: { content: "start" } },
      { type: "assistant", timestamp: "2025-01-01T10:30:00Z", message: { content: "end" } },
    ]);
    const result = analyzeSessionFile(path);
    expect(result.firstTimestamp).toBe("2025-01-01T10:00:00Z");
    expect(result.lastTimestamp).toBe("2025-01-01T10:30:00Z");
  });

  it("handles empty file", () => {
    const path = writeSession("empty.jsonl", []);
    writeFileSync(path, "");
    const result = analyzeSessionFile(path);
    expect(result.promptCount).toBe(0);
    expect(result.inputTokens).toBe(0);
    expect(result.outputTokens).toBe(0);
  });

  it("skips malformed JSON lines", () => {
    const path = join(tmpDir, "malformed.jsonl");
    mkdirSync(tmpDir, { recursive: true });
    writeFileSync(path, [
      '{"type":"user","timestamp":"2025-01-01T00:00:00Z","message":{"content":"hello"}}',
      "not valid json",
      '{"type":"assistant","timestamp":"2025-01-01T00:01:00Z","message":{"content":"hi"}}',
    ].join("\n"));
    const result = analyzeSessionFile(path);
    expect(result.promptCount).toBe(1);
    expect(result.outputTokens).toBeGreaterThan(0);
  });
});
