import { describe, it, expect } from "vitest";
import {
  extractText,
  extractToolUseBlocks,
  normalizeTimestamp,
  preview,
  isCorrection,
} from "../../src/lib/session-parser.js";

// ── extractText ────────────────────────────────────────────────────────────

describe("extractText", () => {
  it("returns string content as-is", () => {
    expect(extractText("hello world")).toBe("hello world");
  });

  it("extracts text from content blocks array", () => {
    const blocks = [
      { type: "text", text: "first" },
      { type: "tool_use", name: "bash", input: {} },
      { type: "text", text: "second" },
    ];
    expect(extractText(blocks)).toBe("first\nsecond");
  });

  it("returns empty string for null/undefined", () => {
    expect(extractText(null)).toBe("");
    expect(extractText(undefined)).toBe("");
  });

  it("returns empty string for non-text arrays", () => {
    expect(extractText([{ type: "tool_use", name: "bash" }])).toBe("");
  });

  it("returns empty string for numbers/objects", () => {
    expect(extractText(42)).toBe("");
    expect(extractText({ foo: "bar" })).toBe("");
  });

  it("skips blocks with non-string text field", () => {
    const blocks = [
      { type: "text", text: 123 },
      { type: "text", text: "valid" },
    ];
    expect(extractText(blocks)).toBe("valid");
  });
});

// ── extractToolUseBlocks ───────────────────────────────────────────────────

describe("extractToolUseBlocks", () => {
  it("returns tool_use blocks from content array", () => {
    const blocks = [
      { type: "text", text: "hello" },
      { type: "tool_use", name: "bash", input: { cmd: "ls" } },
      { type: "tool_use", name: "read", input: { path: "." } },
    ];
    const result = extractToolUseBlocks(blocks);
    expect(result).toHaveLength(2);
    expect(result[0].name).toBe("bash");
    expect(result[1].name).toBe("read");
  });

  it("returns empty array for non-array input", () => {
    expect(extractToolUseBlocks("hello")).toEqual([]);
    expect(extractToolUseBlocks(null)).toEqual([]);
    expect(extractToolUseBlocks(undefined)).toEqual([]);
    expect(extractToolUseBlocks(42)).toEqual([]);
  });

  it("returns empty array when no tool_use blocks", () => {
    expect(extractToolUseBlocks([{ type: "text", text: "hi" }])).toEqual([]);
  });
});

// ── normalizeTimestamp ─────────────────────────────────────────────────────

describe("normalizeTimestamp", () => {
  const fallback = "2025-01-01T00:00:00.000Z";

  it("returns fallback for null/undefined/empty", () => {
    expect(normalizeTimestamp(null, fallback)).toBe(fallback);
    expect(normalizeTimestamp(undefined, fallback)).toBe(fallback);
    expect(normalizeTimestamp("", fallback)).toBe(fallback);
    expect(normalizeTimestamp(0, fallback)).toBe(fallback);
  });

  it("parses valid ISO string", () => {
    const ts = "2025-06-15T10:30:00.000Z";
    expect(normalizeTimestamp(ts, fallback)).toBe(ts);
  });

  it("returns fallback for invalid string", () => {
    expect(normalizeTimestamp("not-a-date", fallback)).toBe(fallback);
  });

  it("handles epoch seconds", () => {
    // 1700000000 = 2023-11-14T22:13:20.000Z
    const result = normalizeTimestamp(1700000000, fallback);
    expect(result).toBe("2023-11-14T22:13:20.000Z");
  });

  it("handles epoch milliseconds", () => {
    const result = normalizeTimestamp(1700000000000, fallback);
    expect(result).toBe("2023-11-14T22:13:20.000Z");
  });

  it("returns fallback for non-string/non-number types", () => {
    expect(normalizeTimestamp({ time: 123 }, fallback)).toBe(fallback);
    expect(normalizeTimestamp(true, fallback)).toBe(fallback);
  });
});

// ── preview ────────────────────────────────────────────────────────────────

describe("preview", () => {
  it("returns short text unchanged", () => {
    expect(preview("hello")).toBe("hello");
  });

  it("truncates long first line with ellipsis", () => {
    const long = "x".repeat(200);
    const result = preview(long);
    expect(result).toHaveLength(121); // 120 + "…"
    expect(result.endsWith("…")).toBe(true);
  });

  it("only uses the first line", () => {
    expect(preview("first line\nsecond line\nthird")).toBe("first line");
  });

  it("respects custom max length", () => {
    const result = preview("abcdefghij", 5);
    expect(result).toBe("abcde…");
  });

  it("handles empty string", () => {
    expect(preview("")).toBe("");
  });
});

// ── isCorrection ───────────────────────────────────────────────────────────

describe("isCorrection", () => {
  it("detects 'no' as correction", () => {
    expect(isCorrection("No, that's wrong")).toBe(true);
  });

  it("detects 'wrong'", () => {
    expect(isCorrection("That's wrong")).toBe(true);
  });

  it("detects 'not that'", () => {
    expect(isCorrection("not that file")).toBe(true);
  });

  it("detects 'i meant'", () => {
    expect(isCorrection("I meant the other one")).toBe(true);
  });

  it("detects 'actually'", () => {
    expect(isCorrection("Actually, use TypeScript")).toBe(true);
  });

  it("detects 'instead'", () => {
    expect(isCorrection("Use vitest instead")).toBe(true);
  });

  it("detects 'undo'", () => {
    expect(isCorrection("Please undo that change")).toBe(true);
  });

  it("returns false for normal prompts", () => {
    expect(isCorrection("Add a new function to parse dates")).toBe(false);
    expect(isCorrection("How does the config system work?")).toBe(false);
  });

  it("is case insensitive", () => {
    expect(isCorrection("WRONG approach")).toBe(true);
    expect(isCorrection("ACTUALLY nevermind")).toBe(true);
  });
});
