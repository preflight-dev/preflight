import { describe, it, expect } from "vitest";
import {
  estimateTokens,
  extractText,
  extractToolNames,
  formatTokens,
  formatCost,
  formatDuration,
  PRICING,
  CORRECTION_SIGNALS,
} from "../../src/tools/estimate-cost.js";

describe("estimateTokens", () => {
  it("estimates ~4 chars per token", () => {
    expect(estimateTokens("abcd")).toBe(1);
    expect(estimateTokens("abcdefgh")).toBe(2);
  });

  it("rounds up", () => {
    expect(estimateTokens("ab")).toBe(1); // 2/4 = 0.5 → ceil = 1
  });

  it("handles empty string", () => {
    expect(estimateTokens("")).toBe(0);
  });
});

describe("extractText", () => {
  it("returns string content directly", () => {
    expect(extractText("hello")).toBe("hello");
  });

  it("extracts text blocks from array content", () => {
    const content = [
      { type: "text", text: "line 1" },
      { type: "text", text: "line 2" },
    ];
    expect(extractText(content)).toBe("line 1\nline 2");
  });

  it("filters non-text blocks", () => {
    const content = [
      { type: "text", text: "hello" },
      { type: "tool_use", name: "read", input: {} },
    ];
    expect(extractText(content)).toBe("hello");
  });

  it("returns empty for null/undefined/number", () => {
    expect(extractText(null)).toBe("");
    expect(extractText(undefined)).toBe("");
    expect(extractText(42)).toBe("");
  });

  it("returns empty for empty array", () => {
    expect(extractText([])).toBe("");
  });
});

describe("extractToolNames", () => {
  it("extracts tool_use names from content blocks", () => {
    const content = [
      { type: "text", text: "thinking..." },
      { type: "tool_use", name: "read", input: { path: "foo.ts" } },
      { type: "tool_use", name: "write", input: { path: "bar.ts" } },
    ];
    expect(extractToolNames(content)).toEqual(["read", "write"]);
  });

  it("returns empty for non-array", () => {
    expect(extractToolNames("string")).toEqual([]);
    expect(extractToolNames(null)).toEqual([]);
  });

  it("skips tool_use blocks without name", () => {
    const content = [{ type: "tool_use", input: {} }];
    expect(extractToolNames(content)).toEqual([]);
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
  });

  it("handles zero", () => {
    expect(formatTokens(0)).toBe("0");
  });

  it("handles boundary at 1000", () => {
    expect(formatTokens(1000)).toBe("1.0k");
    expect(formatTokens(999)).toBe("999");
  });
});

describe("formatCost", () => {
  it("formats normal costs", () => {
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

describe("PRICING", () => {
  it("has required models", () => {
    expect(PRICING["claude-sonnet-4"]).toBeDefined();
    expect(PRICING["claude-opus-4"]).toBeDefined();
    expect(PRICING["claude-haiku-3.5"]).toBeDefined();
  });

  it("has positive prices", () => {
    for (const [, p] of Object.entries(PRICING)) {
      expect(p.input).toBeGreaterThan(0);
      expect(p.output).toBeGreaterThan(0);
      expect(p.output).toBeGreaterThan(p.input); // output always costs more
    }
  });
});

describe("CORRECTION_SIGNALS", () => {
  const positives = [
    "no, that's wrong",
    "Wrong approach",
    "not that one",
    "I meant the other file",
    "actually, use the other method",
    "try again please",
    "revert that change",
    "undo the last edit",
    "that's not what I wanted",
    "not what i asked for",
  ];

  const negatives = [
    "looks good, ship it",
    "nice work on that refactor",
    "add a new function",
    "read the file",
    "knowledge base",      // should not match "no" in "knowledge"
    "annotation",           // should not match "no" in "annotation"
  ];

  for (const phrase of positives) {
    it(`matches correction: "${phrase}"`, () => {
      expect(CORRECTION_SIGNALS.test(phrase)).toBe(true);
    });
  }

  for (const phrase of negatives) {
    it(`does not match non-correction: "${phrase}"`, () => {
      expect(CORRECTION_SIGNALS.test(phrase)).toBe(false);
    });
  }
});
