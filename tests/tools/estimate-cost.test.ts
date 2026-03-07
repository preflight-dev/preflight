import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
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
  it("estimates ~1 token per 4 chars", () => {
    expect(estimateTokens("abcd")).toBe(1);
    expect(estimateTokens("abcde")).toBe(2); // ceil(5/4)
    expect(estimateTokens("")).toBe(0);
  });

  it("handles long strings", () => {
    const text = "a".repeat(4000);
    expect(estimateTokens(text)).toBe(1000);
  });
});

// ── extractText ─────────────────────────────────────────────────────────────

describe("extractText", () => {
  it("returns string content directly", () => {
    expect(extractText("hello")).toBe("hello");
  });

  it("extracts text blocks from array content", () => {
    const content = [
      { type: "text", text: "line one" },
      { type: "text", text: "line two" },
      { type: "tool_use", name: "foo", input: {} },
    ];
    expect(extractText(content)).toBe("line one\nline two");
  });

  it("returns empty string for non-text content", () => {
    expect(extractText(null)).toBe("");
    expect(extractText(42)).toBe("");
    expect(extractText(undefined)).toBe("");
  });

  it("returns empty string for empty array", () => {
    expect(extractText([])).toBe("");
  });
});

// ── extractToolNames ────────────────────────────────────────────────────────

describe("extractToolNames", () => {
  it("extracts tool_use names from content blocks", () => {
    const content = [
      { type: "text", text: "thinking..." },
      { type: "tool_use", name: "read_file", input: {} },
      { type: "tool_use", name: "write_file", input: {} },
    ];
    expect(extractToolNames(content)).toEqual(["read_file", "write_file"]);
  });

  it("returns empty array for non-array input", () => {
    expect(extractToolNames("hello")).toEqual([]);
    expect(extractToolNames(null)).toEqual([]);
  });

  it("skips blocks without name", () => {
    const content = [{ type: "tool_use" }];
    expect(extractToolNames(content)).toEqual([]);
  });
});

// ── formatTokens ────────────────────────────────────────────────────────────

describe("formatTokens", () => {
  it("formats millions", () => {
    expect(formatTokens(1_500_000)).toBe("1.5M");
  });

  it("formats thousands", () => {
    expect(formatTokens(12_500)).toBe("12.5k");
  });

  it("formats small numbers as-is", () => {
    expect(formatTokens(500)).toBe("500");
    expect(formatTokens(0)).toBe("0");
  });
});

// ── formatCost ──────────────────────────────────────────────────────────────

describe("formatCost", () => {
  it("formats dollars with 2 decimals", () => {
    expect(formatCost(1.5)).toBe("$1.50");
    expect(formatCost(0.05)).toBe("$0.05");
  });

  it("shows <$0.01 for tiny amounts", () => {
    expect(formatCost(0.005)).toBe("<$0.01");
    expect(formatCost(0)).toBe("<$0.01");
  });
});

// ── formatDuration ──────────────────────────────────────────────────────────

describe("formatDuration", () => {
  it("formats minutes", () => {
    expect(formatDuration(5 * 60_000)).toBe("5m");
  });

  it("formats hours and minutes", () => {
    expect(formatDuration(90 * 60_000)).toBe("1h 30m");
  });

  it("handles zero", () => {
    expect(formatDuration(0)).toBe("0m");
  });
});

// ── analyzeSessionFile ──────────────────────────────────────────────────────

describe("analyzeSessionFile", () => {
  const tmpDir = join(tmpdir(), "preflight-test-estimate-cost");

  beforeAll(() => {
    mkdirSync(tmpDir, { recursive: true });
  });

  afterAll(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("counts prompts and outputs from JSONL", () => {
    const sessionPath = join(tmpDir, "session1.jsonl");
    const lines = [
      JSON.stringify({
        type: "user",
        timestamp: "2026-03-01T10:00:00Z",
        message: { content: "Hello world" },
      }),
      JSON.stringify({
        type: "assistant",
        timestamp: "2026-03-01T10:00:05Z",
        message: {
          content: [{ type: "text", text: "Hi there, how can I help?" }],
        },
      }),
      JSON.stringify({
        type: "user",
        timestamp: "2026-03-01T10:01:00Z",
        message: { content: "Write a function" },
      }),
      JSON.stringify({
        type: "assistant",
        timestamp: "2026-03-01T10:01:10Z",
        message: {
          content: [{ type: "text", text: "function hello() { return 42; }" }],
        },
      }),
    ];
    writeFileSync(sessionPath, lines.join("\n"));

    const result = analyzeSessionFile(sessionPath);
    expect(result.promptCount).toBe(2);
    expect(result.inputTokens).toBeGreaterThan(0);
    expect(result.outputTokens).toBeGreaterThan(0);
    expect(result.corrections).toBe(0);
    expect(result.firstTimestamp).toBe("2026-03-01T10:00:00Z");
    expect(result.lastTimestamp).toBe("2026-03-01T10:01:10Z");
  });

  it("detects corrections", () => {
    const sessionPath = join(tmpDir, "session2.jsonl");
    const lines = [
      JSON.stringify({
        type: "user",
        timestamp: "2026-03-01T10:00:00Z",
        message: { content: "Make a button" },
      }),
      JSON.stringify({
        type: "assistant",
        timestamp: "2026-03-01T10:00:05Z",
        message: {
          content: [{ type: "text", text: "Here is a red button component" }],
        },
      }),
      JSON.stringify({
        type: "user",
        timestamp: "2026-03-01T10:00:30Z",
        message: { content: "No, not that. I meant a blue one." },
      }),
    ];
    writeFileSync(sessionPath, lines.join("\n"));

    const result = analyzeSessionFile(sessionPath);
    expect(result.corrections).toBe(1);
    expect(result.wastedOutputTokens).toBeGreaterThan(0);
  });

  it("counts tool calls and preflight calls", () => {
    const sessionPath = join(tmpDir, "session3.jsonl");
    const lines = [
      JSON.stringify({
        type: "user",
        timestamp: "2026-03-01T10:00:00Z",
        message: { content: "Check my code" },
      }),
      JSON.stringify({
        type: "assistant",
        timestamp: "2026-03-01T10:00:05Z",
        message: {
          content: [
            { type: "tool_use", name: "preflight_check", input: { prompt: "test" } },
            { type: "tool_use", name: "read_file", input: { path: "foo.ts" } },
            { type: "text", text: "Running checks..." },
          ],
        },
      }),
    ];
    writeFileSync(sessionPath, lines.join("\n"));

    const result = analyzeSessionFile(sessionPath);
    expect(result.toolCallCount).toBe(2);
    expect(result.preflightCalls).toBe(1);
  });

  it("handles empty/malformed lines gracefully", () => {
    const sessionPath = join(tmpDir, "session4.jsonl");
    writeFileSync(sessionPath, "not json\n{}\n\n");

    const result = analyzeSessionFile(sessionPath);
    expect(result.promptCount).toBe(0);
    expect(result.inputTokens).toBe(0);
  });
});
