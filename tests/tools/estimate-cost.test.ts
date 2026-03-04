import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { writeFileSync, mkdtempSync, rmSync } from "node:fs";
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

// ── Unit: estimateTokens ────────────────────────────────────────────────────

describe("estimateTokens", () => {
  it("returns ~1 token per 4 chars", () => {
    expect(estimateTokens("abcd")).toBe(1);
    expect(estimateTokens("abcde")).toBe(2); // ceil(5/4)
  });

  it("returns 0 for empty string", () => {
    expect(estimateTokens("")).toBe(0);
  });
});

// ── Unit: extractText ───────────────────────────────────────────────────────

describe("extractText", () => {
  it("returns string content as-is", () => {
    expect(extractText("hello world")).toBe("hello world");
  });

  it("extracts text from content block arrays", () => {
    const blocks = [
      { type: "text", text: "hello" },
      { type: "text", text: "world" },
    ];
    expect(extractText(blocks)).toBe("hello\nworld");
  });

  it("filters out non-text blocks", () => {
    const blocks = [
      { type: "text", text: "hello" },
      { type: "tool_use", name: "foo", input: {} },
    ];
    expect(extractText(blocks)).toBe("hello");
  });

  it("returns empty string for unknown types", () => {
    expect(extractText(42)).toBe("");
    expect(extractText(null)).toBe("");
    expect(extractText(undefined)).toBe("");
  });
});

// ── Unit: extractToolNames ──────────────────────────────────────────────────

describe("extractToolNames", () => {
  it("extracts tool names from content blocks", () => {
    const blocks = [
      { type: "text", text: "thinking..." },
      { type: "tool_use", name: "preflight_check", input: {} },
      { type: "tool_use", name: "scope_work", input: {} },
    ];
    expect(extractToolNames(blocks)).toEqual(["preflight_check", "scope_work"]);
  });

  it("returns empty array for non-array input", () => {
    expect(extractToolNames("hello")).toEqual([]);
    expect(extractToolNames(null)).toEqual([]);
  });

  it("skips tool_use blocks without name", () => {
    const blocks = [{ type: "tool_use", input: {} }];
    expect(extractToolNames(blocks)).toEqual([]);
  });
});

// ── Unit: formatTokens ──────────────────────────────────────────────────────

describe("formatTokens", () => {
  it("formats millions", () => {
    expect(formatTokens(1_500_000)).toBe("1.5M");
  });

  it("formats thousands", () => {
    expect(formatTokens(12_500)).toBe("12.5k");
  });

  it("formats small numbers as-is", () => {
    expect(formatTokens(500)).toBe("500");
  });
});

// ── Unit: formatCost ────────────────────────────────────────────────────────

describe("formatCost", () => {
  it("formats normal costs", () => {
    expect(formatCost(1.5)).toBe("$1.50");
  });

  it("shows <$0.01 for tiny costs", () => {
    expect(formatCost(0.005)).toBe("<$0.01");
  });
});

// ── Unit: formatDuration ────────────────────────────────────────────────────

describe("formatDuration", () => {
  it("formats minutes", () => {
    expect(formatDuration(300_000)).toBe("5m");
  });

  it("formats hours and minutes", () => {
    expect(formatDuration(5_400_000)).toBe("1h 30m");
  });
});

// ── Integration: analyzeSessionFile ─────────────────────────────────────────

describe("analyzeSessionFile", () => {
  let tmpDir: string;

  beforeAll(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "pf-estimate-cost-"));
  });

  afterAll(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("parses a basic session with user and assistant messages", () => {
    const lines = [
      JSON.stringify({ type: "user", timestamp: "2026-01-01T00:00:00Z", message: { content: "Fix the bug in auth.ts" } }),
      JSON.stringify({ type: "assistant", timestamp: "2026-01-01T00:01:00Z", message: { content: [{ type: "text", text: "I'll fix that for you." }] } }),
    ];
    const file = join(tmpDir, "basic.jsonl");
    writeFileSync(file, lines.join("\n"));

    const result = analyzeSessionFile(file);
    expect(result.promptCount).toBe(1);
    expect(result.inputTokens).toBeGreaterThan(0);
    expect(result.outputTokens).toBeGreaterThan(0);
    expect(result.corrections).toBe(0);
    expect(result.firstTimestamp).toBe("2026-01-01T00:00:00Z");
    expect(result.lastTimestamp).toBe("2026-01-01T00:01:00Z");
  });

  it("detects corrections", () => {
    const lines = [
      JSON.stringify({ type: "user", timestamp: "2026-01-01T00:00:00Z", message: { content: "Rename the variable" } }),
      JSON.stringify({ type: "assistant", timestamp: "2026-01-01T00:01:00Z", message: { content: [{ type: "text", text: "Done, renamed foo to bar." }] } }),
      JSON.stringify({ type: "user", timestamp: "2026-01-01T00:02:00Z", message: { content: "No, not that one. I meant the other variable." } }),
    ];
    const file = join(tmpDir, "corrections.jsonl");
    writeFileSync(file, lines.join("\n"));

    const result = analyzeSessionFile(file);
    expect(result.corrections).toBe(1);
    expect(result.wastedOutputTokens).toBeGreaterThan(0);
  });

  it("counts tool calls and preflight calls", () => {
    const lines = [
      JSON.stringify({ type: "user", timestamp: "2026-01-01T00:00:00Z", message: { content: "Check this prompt" } }),
      JSON.stringify({
        type: "assistant",
        timestamp: "2026-01-01T00:01:00Z",
        message: {
          content: [
            { type: "tool_use", name: "preflight_check", input: { prompt: "test" } },
            { type: "tool_use", name: "Read", input: { path: "foo.ts" } },
            { type: "text", text: "Here are the results." },
          ],
        },
      }),
    ];
    const file = join(tmpDir, "tools.jsonl");
    writeFileSync(file, lines.join("\n"));

    const result = analyzeSessionFile(file);
    expect(result.toolCallCount).toBe(2);
    expect(result.preflightCalls).toBe(1);
    expect(result.preflightTokens).toBeGreaterThan(0);
  });

  it("handles empty files", () => {
    const file = join(tmpDir, "empty.jsonl");
    writeFileSync(file, "");

    const result = analyzeSessionFile(file);
    expect(result.promptCount).toBe(0);
    expect(result.inputTokens).toBe(0);
    expect(result.outputTokens).toBe(0);
  });

  it("handles malformed JSON lines gracefully", () => {
    const lines = [
      "not json",
      JSON.stringify({ type: "user", timestamp: "2026-01-01T00:00:00Z", message: { content: "hello" } }),
      "{broken",
    ];
    const file = join(tmpDir, "malformed.jsonl");
    writeFileSync(file, lines.join("\n"));

    const result = analyzeSessionFile(file);
    expect(result.promptCount).toBe(1);
  });
});
