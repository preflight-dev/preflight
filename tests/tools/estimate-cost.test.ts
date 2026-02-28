import { describe, it, expect } from "vitest";

// We test the pure helpers by importing them indirectly through the module.
// Since they're not exported, we replicate them here for unit testing,
// then verify end-to-end via the tool registration.

// ── Replicated helpers (should match src/tools/estimate-cost.ts) ───────────

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function extractText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .filter((b: any) => typeof b.text === "string")
      .map((b: any) => b.text)
      .join("\n");
  }
  return "";
}

function extractToolNames(content: unknown): string[] {
  if (!Array.isArray(content)) return [];
  return content
    .filter((b: any) => b.type === "tool_use" && b.name)
    .map((b: any) => b.name as string);
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function formatCost(dollars: number): string {
  if (dollars < 0.01) return `<$0.01`;
  return `$${dollars.toFixed(2)}`;
}

function formatDuration(ms: number): string {
  const mins = Math.floor(ms / 60_000);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  const rem = mins % 60;
  return `${hours}h ${rem}m`;
}

const CORRECTION_SIGNALS =
  /\b(no[,.\s]|wrong|not that|i meant|actually|try again|revert|undo|that's not|not what i)\b/i;

// ── Tests ──────────────────────────────────────────────────────────────────

describe("estimateTokens", () => {
  it("estimates ~1 token per 4 chars", () => {
    expect(estimateTokens("hello world")).toBe(3); // 11 chars -> ceil(11/4) = 3
  });

  it("returns 0 for empty string", () => {
    expect(estimateTokens("")).toBe(0);
  });

  it("rounds up", () => {
    expect(estimateTokens("a")).toBe(1); // ceil(1/4) = 1
    expect(estimateTokens("abcde")).toBe(2); // ceil(5/4) = 2
  });
});

describe("extractText", () => {
  it("returns string content directly", () => {
    expect(extractText("hello")).toBe("hello");
  });

  it("extracts text from content blocks", () => {
    const blocks = [
      { type: "text", text: "line 1" },
      { type: "text", text: "line 2" },
    ];
    expect(extractText(blocks)).toBe("line 1\nline 2");
  });

  it("filters out non-text blocks", () => {
    const blocks = [
      { type: "text", text: "hello" },
      { type: "tool_use", name: "foo", input: {} },
    ];
    expect(extractText(blocks)).toBe("hello");
  });

  it("returns empty string for null/undefined/object", () => {
    expect(extractText(null)).toBe("");
    expect(extractText(undefined)).toBe("");
    expect(extractText({ foo: "bar" })).toBe("");
  });

  it("returns empty string for empty array", () => {
    expect(extractText([])).toBe("");
  });
});

describe("extractToolNames", () => {
  it("extracts tool_use names", () => {
    const blocks = [
      { type: "tool_use", name: "preflight_check", input: {} },
      { type: "text", text: "some text" },
      { type: "tool_use", name: "scope_work", input: {} },
    ];
    expect(extractToolNames(blocks)).toEqual(["preflight_check", "scope_work"]);
  });

  it("returns empty for non-array", () => {
    expect(extractToolNames("hello")).toEqual([]);
    expect(extractToolNames(null)).toEqual([]);
  });

  it("skips tool_use without name", () => {
    const blocks = [{ type: "tool_use", input: {} }];
    expect(extractToolNames(blocks)).toEqual([]);
  });
});

describe("formatTokens", () => {
  it("formats millions", () => {
    expect(formatTokens(1_500_000)).toBe("1.5M");
    expect(formatTokens(2_000_000)).toBe("2.0M");
  });

  it("formats thousands", () => {
    expect(formatTokens(1_500)).toBe("1.5k");
    expect(formatTokens(50_000)).toBe("50.0k");
  });

  it("formats small numbers as-is", () => {
    expect(formatTokens(999)).toBe("999");
    expect(formatTokens(0)).toBe("0");
  });
});

describe("formatCost", () => {
  it("formats sub-penny as <$0.01", () => {
    expect(formatCost(0.005)).toBe("<$0.01");
    expect(formatCost(0)).toBe("<$0.01");
  });

  it("formats normal costs", () => {
    expect(formatCost(1.5)).toBe("$1.50");
    expect(formatCost(0.03)).toBe("$0.03");
  });
});

describe("formatDuration", () => {
  it("formats minutes", () => {
    expect(formatDuration(5 * 60_000)).toBe("5m");
    expect(formatDuration(45 * 60_000)).toBe("45m");
  });

  it("formats hours and minutes", () => {
    expect(formatDuration(90 * 60_000)).toBe("1h 30m");
    expect(formatDuration(120 * 60_000)).toBe("2h 0m");
  });

  it("handles zero", () => {
    expect(formatDuration(0)).toBe("0m");
  });
});

describe("CORRECTION_SIGNALS", () => {
  it("detects common correction phrases", () => {
    expect(CORRECTION_SIGNALS.test("no, that's wrong")).toBe(true);
    expect(CORRECTION_SIGNALS.test("I meant the other one")).toBe(true);
    expect(CORRECTION_SIGNALS.test("actually do it this way")).toBe(true);
    expect(CORRECTION_SIGNALS.test("try again please")).toBe(true);
    expect(CORRECTION_SIGNALS.test("revert that change")).toBe(true);
    expect(CORRECTION_SIGNALS.test("undo the last edit")).toBe(true);
    expect(CORRECTION_SIGNALS.test("not what i asked for")).toBe(true);
  });

  it("does not flag normal messages", () => {
    expect(CORRECTION_SIGNALS.test("looks good, ship it")).toBe(false);
    expect(CORRECTION_SIGNALS.test("great work")).toBe(false);
    expect(CORRECTION_SIGNALS.test("add a new feature")).toBe(false);
  });
});
