import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import {
  estimateTokens,
  extractText,
  extractToolNames,
  formatTokens,
  formatCost,
  formatDuration,
  analyzeSessionFile,
} from "../src/tools/estimate-cost.js";

// ── Pure helpers ────────────────────────────────────────────────────────────

describe("estimateTokens", () => {
  it("estimates ~1 token per 4 chars", () => {
    expect(estimateTokens("abcd")).toBe(1);
    expect(estimateTokens("abcde")).toBe(2); // ceil(5/4)
    expect(estimateTokens("")).toBe(0);
  });

  it("handles long strings", () => {
    const text = "x".repeat(4000);
    expect(estimateTokens(text)).toBe(1000);
  });
});

describe("extractText", () => {
  it("returns string content directly", () => {
    expect(extractText("hello")).toBe("hello");
  });

  it("extracts text from content block arrays", () => {
    const blocks = [
      { type: "text", text: "line 1" },
      { type: "text", text: "line 2" },
    ];
    expect(extractText(blocks)).toBe("line 1\nline 2");
  });

  it("skips non-text blocks", () => {
    const blocks = [
      { type: "text", text: "hello" },
      { type: "tool_use", name: "foo", input: {} },
    ];
    expect(extractText(blocks)).toBe("hello");
  });

  it("returns empty for null/undefined/numbers", () => {
    expect(extractText(null)).toBe("");
    expect(extractText(undefined)).toBe("");
    expect(extractText(42)).toBe("");
  });

  it("returns empty for empty array", () => {
    expect(extractText([])).toBe("");
  });
});

describe("extractToolNames", () => {
  it("extracts tool names from content blocks", () => {
    const blocks = [
      { type: "text", text: "thinking..." },
      { type: "tool_use", name: "preflight_check", input: {} },
      { type: "tool_use", name: "scope_work", input: {} },
    ];
    expect(extractToolNames(blocks)).toEqual(["preflight_check", "scope_work"]);
  });

  it("returns empty for non-array input", () => {
    expect(extractToolNames("hello")).toEqual([]);
    expect(extractToolNames(null)).toEqual([]);
  });

  it("skips blocks without name", () => {
    const blocks = [{ type: "tool_use" }];
    expect(extractToolNames(blocks)).toEqual([]);
  });
});

describe("formatTokens", () => {
  it("formats millions", () => {
    expect(formatTokens(1_500_000)).toBe("1.5M");
  });

  it("formats thousands", () => {
    expect(formatTokens(42_000)).toBe("42.0k");
  });

  it("formats small numbers as-is", () => {
    expect(formatTokens(500)).toBe("500");
    expect(formatTokens(0)).toBe("0");
  });
});

describe("formatCost", () => {
  it("formats dollars with 2 decimals", () => {
    expect(formatCost(1.5)).toBe("$1.50");
    expect(formatCost(0.05)).toBe("$0.05");
  });

  it("shows <$0.01 for tiny amounts", () => {
    expect(formatCost(0.001)).toBe("<$0.01");
    expect(formatCost(0)).toBe("<$0.01");
  });
});

describe("formatDuration", () => {
  it("formats minutes", () => {
    expect(formatDuration(5 * 60_000)).toBe("5m");
    expect(formatDuration(0)).toBe("0m");
  });

  it("formats hours and minutes", () => {
    expect(formatDuration(90 * 60_000)).toBe("1h 30m");
    expect(formatDuration(120 * 60_000)).toBe("2h 0m");
  });
});

// ── analyzeSessionFile ──────────────────────────────────────────────────────

describe("analyzeSessionFile", () => {
  const tmpDir = join(import.meta.dirname ?? ".", ".tmp-test-sessions");

  beforeAll(() => {
    mkdirSync(tmpDir, { recursive: true });
  });

  afterAll(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  function writeSession(name: string, lines: object[]): string {
    const path = join(tmpDir, name);
    writeFileSync(path, lines.map((l) => JSON.stringify(l)).join("\n"));
    return path;
  }

  it("counts user prompts and input tokens", () => {
    const path = writeSession("basic.jsonl", [
      { type: "user", message: { content: "Hello world" }, timestamp: "2025-01-01T00:00:00Z" },
      { type: "assistant", message: { content: "Hi there!" }, timestamp: "2025-01-01T00:01:00Z" },
    ]);
    const result = analyzeSessionFile(path);
    expect(result.promptCount).toBe(1);
    expect(result.inputTokens).toBeGreaterThan(0);
    expect(result.outputTokens).toBeGreaterThan(0);
  });

  it("detects corrections", () => {
    const path = writeSession("corrections.jsonl", [
      { type: "user", message: { content: "Fix the login" }, timestamp: "2025-01-01T00:00:00Z" },
      { type: "assistant", message: { content: "I updated the login page with new styles" }, timestamp: "2025-01-01T00:01:00Z" },
      { type: "user", message: { content: "No, that's not what I meant, revert that" }, timestamp: "2025-01-01T00:02:00Z" },
    ]);
    const result = analyzeSessionFile(path);
    expect(result.corrections).toBe(1);
    expect(result.wastedOutputTokens).toBeGreaterThan(0);
  });

  it("counts tool calls", () => {
    const path = writeSession("tools.jsonl", [
      { type: "user", message: { content: "Check the code" }, timestamp: "2025-01-01T00:00:00Z" },
      {
        type: "assistant",
        message: {
          content: [
            { type: "text", text: "Let me check..." },
            { type: "tool_use", name: "preflight_check", input: { task: "review" } },
          ],
        },
        timestamp: "2025-01-01T00:01:00Z",
      },
    ]);
    const result = analyzeSessionFile(path);
    expect(result.toolCallCount).toBe(1);
    expect(result.preflightCalls).toBe(1);
    expect(result.preflightTokens).toBeGreaterThan(0);
  });

  it("tracks timestamps for duration", () => {
    const path = writeSession("duration.jsonl", [
      { type: "user", message: { content: "start" }, timestamp: "2025-01-01T10:00:00Z" },
      { type: "assistant", message: { content: "done" }, timestamp: "2025-01-01T11:30:00Z" },
    ]);
    const result = analyzeSessionFile(path);
    expect(result.firstTimestamp).toBe("2025-01-01T10:00:00Z");
    expect(result.lastTimestamp).toBe("2025-01-01T11:30:00Z");
  });

  it("handles empty file gracefully", () => {
    const path = writeSession("empty.jsonl", []);
    const result = analyzeSessionFile(path);
    expect(result.promptCount).toBe(0);
    expect(result.inputTokens).toBe(0);
    expect(result.outputTokens).toBe(0);
    expect(result.firstTimestamp).toBeNull();
  });

  it("skips malformed JSON lines", () => {
    const path = join(tmpDir, "malformed.jsonl");
    writeFileSync(path, 'not json\n{"type":"user","message":{"content":"hi"},"timestamp":"2025-01-01T00:00:00Z"}\n');
    const result = analyzeSessionFile(path);
    expect(result.promptCount).toBe(1);
  });

  it("handles tool_result messages", () => {
    const path = writeSession("tool-result.jsonl", [
      { type: "user", message: { content: "check" }, timestamp: "2025-01-01T00:00:00Z" },
      { type: "tool_result", content: "Tool output here", tool_use_id: "abc123" },
    ]);
    const result = analyzeSessionFile(path);
    // tool_result content counts as input tokens
    expect(result.inputTokens).toBeGreaterThan(0);
  });
});
