import { describe, it, expect } from "vitest";
import {
  estimateTokens,
  extractText,
  extractToolNames,
  formatTokens,
  formatCost,
  formatDuration,
  analyzeSessionFile,
} from "../../src/tools/estimate-cost.js";
import { writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("estimateTokens", () => {
  it("estimates ~1 token per 4 chars", () => {
    expect(estimateTokens("abcd")).toBe(1);
    expect(estimateTokens("abcde")).toBe(2); // ceil(5/4)
    expect(estimateTokens("")).toBe(0);
  });

  it("handles long text", () => {
    const text = "a".repeat(4000);
    expect(estimateTokens(text)).toBe(1000);
  });
});

describe("extractText", () => {
  it("returns string content as-is", () => {
    expect(extractText("hello")).toBe("hello");
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

  it("returns empty string for null/undefined/objects", () => {
    expect(extractText(null)).toBe("");
    expect(extractText(undefined)).toBe("");
    expect(extractText({ foo: "bar" })).toBe("");
  });
});

describe("extractToolNames", () => {
  it("extracts tool names from content blocks", () => {
    const blocks = [
      { type: "tool_use", name: "preflight_check", input: {} },
      { type: "text", text: "hello" },
      { type: "tool_use", name: "scope_work", input: {} },
    ];
    expect(extractToolNames(blocks)).toEqual(["preflight_check", "scope_work"]);
  });

  it("returns empty for non-array", () => {
    expect(extractToolNames("hello")).toEqual([]);
    expect(extractToolNames(null)).toEqual([]);
  });

  it("skips tool_use blocks without name", () => {
    const blocks = [{ type: "tool_use", input: {} }];
    expect(extractToolNames(blocks)).toEqual([]);
  });
});

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

describe("formatCost", () => {
  it("shows <$0.01 for tiny amounts", () => {
    expect(formatCost(0.005)).toBe("<$0.01");
    expect(formatCost(0)).toBe("<$0.01");
  });

  it("formats normally for larger amounts", () => {
    expect(formatCost(1.5)).toBe("$1.50");
    expect(formatCost(0.12)).toBe("$0.12");
  });
});

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

describe("analyzeSessionFile", () => {
  const tmpDir = join(tmpdir(), "preflight-test-" + Date.now());

  function writeSession(name: string, lines: object[]): string {
    mkdirSync(tmpDir, { recursive: true });
    const p = join(tmpDir, name);
    writeFileSync(p, lines.map((l) => JSON.stringify(l)).join("\n"));
    return p;
  }

  afterAll(() => {
    try { rmSync(tmpDir, { recursive: true }); } catch {}
  });

  it("counts user prompts and tokens", () => {
    const f = writeSession("basic.jsonl", [
      { type: "user", message: { content: "hello world" }, timestamp: "2026-01-01T00:00:00Z" },
      { type: "assistant", message: { content: "hi there friend" }, timestamp: "2026-01-01T00:01:00Z" },
    ]);
    const result = analyzeSessionFile(f);
    expect(result.promptCount).toBe(1);
    expect(result.inputTokens).toBeGreaterThan(0);
    expect(result.outputTokens).toBeGreaterThan(0);
  });

  it("detects corrections", () => {
    const f = writeSession("corrections.jsonl", [
      { type: "user", message: { content: "do X" }, timestamp: "2026-01-01T00:00:00Z" },
      { type: "assistant", message: { content: "here is X result with lots of output text" }, timestamp: "2026-01-01T00:01:00Z" },
      { type: "user", message: { content: "no, that's not what I meant" }, timestamp: "2026-01-01T00:02:00Z" },
    ]);
    const result = analyzeSessionFile(f);
    expect(result.corrections).toBe(1);
    expect(result.wastedOutputTokens).toBeGreaterThan(0);
  });

  it("counts preflight tool calls", () => {
    const f = writeSession("preflight.jsonl", [
      { type: "user", message: { content: "check this" }, timestamp: "2026-01-01T00:00:00Z" },
      {
        type: "assistant",
        message: {
          content: [
            { type: "tool_use", name: "preflight_check", input: { prompt: "test" } },
            { type: "text", text: "checking..." },
          ],
        },
        timestamp: "2026-01-01T00:01:00Z",
      },
    ]);
    const result = analyzeSessionFile(f);
    expect(result.preflightCalls).toBe(1);
    expect(result.toolCallCount).toBe(1);
    expect(result.preflightTokens).toBeGreaterThan(0);
  });

  it("tracks timestamps for duration", () => {
    const f = writeSession("timestamps.jsonl", [
      { type: "user", message: { content: "start" }, timestamp: "2026-01-01T00:00:00Z" },
      { type: "assistant", message: { content: "end" }, timestamp: "2026-01-01T01:30:00Z" },
    ]);
    const result = analyzeSessionFile(f);
    expect(result.firstTimestamp).toBe("2026-01-01T00:00:00Z");
    expect(result.lastTimestamp).toBe("2026-01-01T01:30:00Z");
  });

  it("handles malformed lines gracefully", () => {
    const f = writeSession("malformed.jsonl", [
      { type: "user", message: { content: "ok" }, timestamp: "2026-01-01T00:00:00Z" },
    ]);
    // Append garbage
    writeFileSync(f, "\nnot json\n{bad", { flag: "a" });
    const result = analyzeSessionFile(f);
    expect(result.promptCount).toBe(1);
  });
});
