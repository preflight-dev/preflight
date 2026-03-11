import { describe, it, expect } from "vitest";
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

  it("extracts text from content blocks", () => {
    const blocks = [
      { type: "text", text: "hello" },
      { type: "text", text: "world" },
    ];
    expect(extractText(blocks)).toBe("hello\nworld");
  });

  it("skips non-text blocks", () => {
    const blocks = [
      { type: "text", text: "hello" },
      { type: "tool_use", name: "foo", input: {} },
    ];
    expect(extractText(blocks)).toBe("hello");
  });

  it("returns empty for null/undefined", () => {
    expect(extractText(null)).toBe("");
    expect(extractText(undefined)).toBe("");
    expect(extractText(42)).toBe("");
  });
});

describe("extractToolNames", () => {
  it("extracts tool names from content blocks", () => {
    const blocks = [
      { type: "tool_use", name: "preflight_check", input: {} },
      { type: "text", text: "done" },
      { type: "tool_use", name: "scope_work", input: {} },
    ];
    expect(extractToolNames(blocks)).toEqual(["preflight_check", "scope_work"]);
  });

  it("returns empty for non-array", () => {
    expect(extractToolNames("string")).toEqual([]);
    expect(extractToolNames(null)).toEqual([]);
  });
});

describe("formatTokens", () => {
  it("formats millions", () => {
    expect(formatTokens(1_500_000)).toBe("1.5M");
  });

  it("formats thousands", () => {
    expect(formatTokens(42_500)).toBe("42.5k");
  });

  it("formats small numbers as-is", () => {
    expect(formatTokens(999)).toBe("999");
    expect(formatTokens(0)).toBe("0");
  });
});

describe("formatCost", () => {
  it("formats dollar amounts", () => {
    expect(formatCost(1.5)).toBe("$1.50");
    expect(formatCost(0.05)).toBe("$0.05");
  });

  it("shows <$0.01 for tiny amounts", () => {
    expect(formatCost(0.005)).toBe("<$0.01");
    expect(formatCost(0)).toBe("<$0.01");
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
  let tmpDir: string;

  function writeSession(lines: object[]): string {
    tmpDir = mkdtempSync(join(tmpdir(), "preflight-test-"));
    const filePath = join(tmpDir, "session.jsonl");
    writeFileSync(filePath, lines.map((l) => JSON.stringify(l)).join("\n"));
    return filePath;
  }

  it("counts user prompts and tokens", () => {
    const fp = writeSession([
      { type: "user", message: { content: "hello world" }, timestamp: "2026-01-01T00:00:00Z" },
      { type: "assistant", message: { content: "hi there" }, timestamp: "2026-01-01T00:01:00Z" },
    ]);
    const result = analyzeSessionFile(fp);
    expect(result.promptCount).toBe(1);
    expect(result.inputTokens).toBe(estimateTokens("hello world"));
    expect(result.outputTokens).toBe(estimateTokens("hi there"));
    rmSync(tmpDir, { recursive: true });
  });

  it("detects corrections", () => {
    const fp = writeSession([
      { type: "user", message: { content: "do the thing" }, timestamp: "2026-01-01T00:00:00Z" },
      { type: "assistant", message: { content: "here is the result with lots of output text" }, timestamp: "2026-01-01T00:01:00Z" },
      { type: "user", message: { content: "no, that's not what i meant" }, timestamp: "2026-01-01T00:02:00Z" },
    ]);
    const result = analyzeSessionFile(fp);
    expect(result.corrections).toBe(1);
    expect(result.wastedOutputTokens).toBeGreaterThan(0);
    rmSync(tmpDir, { recursive: true });
  });

  it("counts tool calls and preflight calls", () => {
    const fp = writeSession([
      { type: "user", message: { content: "check this" }, timestamp: "2026-01-01T00:00:00Z" },
      {
        type: "assistant",
        message: {
          content: [
            { type: "tool_use", name: "preflight_check", input: { prompt: "test" } },
            { type: "tool_use", name: "some_other_tool", input: {} },
            { type: "text", text: "done" },
          ],
        },
        timestamp: "2026-01-01T00:01:00Z",
      },
    ]);
    const result = analyzeSessionFile(fp);
    expect(result.toolCallCount).toBe(2);
    expect(result.preflightCalls).toBe(1);
    expect(result.preflightTokens).toBeGreaterThan(0);
    rmSync(tmpDir, { recursive: true });
  });

  it("tracks timestamps", () => {
    const fp = writeSession([
      { type: "user", message: { content: "a" }, timestamp: "2026-01-01T00:00:00Z" },
      { type: "assistant", message: { content: "b" }, timestamp: "2026-01-01T01:30:00Z" },
    ]);
    const result = analyzeSessionFile(fp);
    expect(result.firstTimestamp).toBe("2026-01-01T00:00:00Z");
    expect(result.lastTimestamp).toBe("2026-01-01T01:30:00Z");
    rmSync(tmpDir, { recursive: true });
  });

  it("handles tool_result entries", () => {
    const fp = writeSession([
      { type: "user", message: { content: "go" }, timestamp: "2026-01-01T00:00:00Z" },
      { type: "tool_result", content: "tool output here", tool_use_id: "123" },
    ]);
    const result = analyzeSessionFile(fp);
    expect(result.inputTokens).toBe(
      estimateTokens("go") + estimateTokens("tool output here"),
    );
    rmSync(tmpDir, { recursive: true });
  });
});
