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
} from "../src/tools/estimate-cost.js";

describe("estimateTokens", () => {
  it("returns ~1 token per 4 chars", () => {
    expect(estimateTokens("abcd")).toBe(1);
    expect(estimateTokens("abcde")).toBe(2); // ceil(5/4)
    expect(estimateTokens("")).toBe(0);
  });
});

describe("extractText", () => {
  it("returns string content as-is", () => {
    expect(extractText("hello")).toBe("hello");
  });

  it("joins text blocks from array content", () => {
    const blocks = [
      { type: "text", text: "line 1" },
      { type: "text", text: "line 2" },
      { type: "tool_use", name: "foo" },
    ];
    expect(extractText(blocks)).toBe("line 1\nline 2");
  });

  it("returns empty string for null/undefined/object", () => {
    expect(extractText(null)).toBe("");
    expect(extractText(undefined)).toBe("");
    expect(extractText({ foo: "bar" })).toBe("");
  });
});

describe("extractToolNames", () => {
  it("extracts tool_use names from content blocks", () => {
    const blocks = [
      { type: "text", text: "thinking..." },
      { type: "tool_use", name: "read_file", input: {} },
      { type: "tool_use", name: "write_file", input: {} },
    ];
    expect(extractToolNames(blocks)).toEqual(["read_file", "write_file"]);
  });

  it("returns empty array for non-array input", () => {
    expect(extractToolNames("hello")).toEqual([]);
    expect(extractToolNames(null)).toEqual([]);
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
  });
});

describe("formatCost", () => {
  it("shows <$0.01 for tiny amounts", () => {
    expect(formatCost(0.005)).toBe("<$0.01");
  });

  it("formats dollars with two decimals", () => {
    expect(formatCost(1.5)).toBe("$1.50");
    expect(formatCost(0.03)).toBe("$0.03");
  });
});

describe("formatDuration", () => {
  it("formats minutes under an hour", () => {
    expect(formatDuration(5 * 60_000)).toBe("5m");
  });

  it("formats hours and minutes", () => {
    expect(formatDuration(90 * 60_000)).toBe("1h 30m");
  });
});

describe("analyzeSessionFile", () => {
  let tmpDir: string;

  function writeSession(lines: object[]): string {
    tmpDir = mkdtempSync(join(tmpdir(), "pf-test-"));
    const filePath = join(tmpDir, "session.jsonl");
    writeFileSync(filePath, lines.map((l) => JSON.stringify(l)).join("\n"));
    return filePath;
  }

  it("counts user prompts and assistant output tokens", () => {
    const fp = writeSession([
      {
        type: "user",
        timestamp: "2026-01-01T00:00:00Z",
        message: { content: "hello world" },
      },
      {
        type: "assistant",
        timestamp: "2026-01-01T00:00:05Z",
        message: { content: "hi there, how can I help?" },
      },
    ]);
    const result = analyzeSessionFile(fp);
    expect(result.promptCount).toBe(1);
    expect(result.inputTokens).toBeGreaterThan(0);
    expect(result.outputTokens).toBeGreaterThan(0);
    expect(result.corrections).toBe(0);
    rmSync(tmpDir, { recursive: true });
  });

  it("detects corrections", () => {
    const fp = writeSession([
      {
        type: "user",
        timestamp: "2026-01-01T00:00:00Z",
        message: { content: "write a function" },
      },
      {
        type: "assistant",
        timestamp: "2026-01-01T00:00:05Z",
        message: { content: "here is the function..." },
      },
      {
        type: "user",
        timestamp: "2026-01-01T00:00:10Z",
        message: { content: "no, that's not what I meant" },
      },
    ]);
    const result = analyzeSessionFile(fp);
    expect(result.corrections).toBe(1);
    expect(result.wastedOutputTokens).toBeGreaterThan(0);
    rmSync(tmpDir, { recursive: true });
  });

  it("counts preflight tool calls", () => {
    const fp = writeSession([
      {
        type: "user",
        timestamp: "2026-01-01T00:00:00Z",
        message: { content: "check my prompt" },
      },
      {
        type: "assistant",
        timestamp: "2026-01-01T00:00:05Z",
        message: {
          content: [
            {
              type: "tool_use",
              name: "preflight_check",
              input: { prompt: "test" },
            },
            { type: "text", text: "Running preflight..." },
          ],
        },
      },
    ]);
    const result = analyzeSessionFile(fp);
    expect(result.preflightCalls).toBe(1);
    expect(result.toolCallCount).toBe(1);
    rmSync(tmpDir, { recursive: true });
  });

  it("tracks timestamps", () => {
    const fp = writeSession([
      {
        type: "user",
        timestamp: "2026-01-01T00:00:00Z",
        message: { content: "first" },
      },
      {
        type: "assistant",
        timestamp: "2026-01-01T01:30:00Z",
        message: { content: "last" },
      },
    ]);
    const result = analyzeSessionFile(fp);
    expect(result.firstTimestamp).toBe("2026-01-01T00:00:00Z");
    expect(result.lastTimestamp).toBe("2026-01-01T01:30:00Z");
    rmSync(tmpDir, { recursive: true });
  });
});
