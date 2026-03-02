import { describe, it, expect } from "vitest";
import { matchPatterns, formatPatternMatches, type CorrectionPattern } from "../src/lib/patterns.js";

function makePattern(overrides: Partial<CorrectionPattern> = {}): CorrectionPattern {
  return {
    id: "p1",
    pattern: "Recurring correction: auth, token, refresh, expired",
    keywords: ["auth", "token", "refresh", "expired"],
    frequency: 3,
    lastSeen: new Date().toISOString(),
    context: "Token refresh was failing silently",
    examples: ["fix the auth token"],
    ...overrides,
  };
}

describe("matchPatterns", () => {
  it("matches when 2+ keywords appear in prompt", () => {
    const patterns = [makePattern()];
    const matches = matchPatterns("the auth token is broken", patterns);
    expect(matches).toHaveLength(1);
  });

  it("does not match with only 1 keyword", () => {
    const patterns = [makePattern()];
    const matches = matchPatterns("the auth system is down", patterns);
    expect(matches).toHaveLength(0);
  });

  it("returns empty for empty patterns list", () => {
    expect(matchPatterns("anything here", [])).toEqual([]);
  });

  it("matches case-insensitively", () => {
    const patterns = [makePattern()];
    const matches = matchPatterns("AUTH TOKEN issue", patterns);
    expect(matches).toHaveLength(1);
  });

  it("can match multiple patterns", () => {
    const patterns = [
      makePattern({ id: "p1", keywords: ["auth", "token", "refresh"] }),
      makePattern({ id: "p2", keywords: ["deploy", "docker", "build"] }),
    ];
    const matches = matchPatterns("auth token deploy docker", patterns);
    expect(matches).toHaveLength(2);
  });
});

describe("formatPatternMatches", () => {
  it("returns empty string for no matches", () => {
    expect(formatPatternMatches([])).toBe("");
  });

  it("formats matches with header and details", () => {
    const result = formatPatternMatches([makePattern()]);
    expect(result).toContain("Known patterns matched");
    expect(result).toContain("corrected 3x");
    expect(result).toContain("Token refresh");
  });

  it("numbers multiple matches", () => {
    const result = formatPatternMatches([
      makePattern({ id: "p1" }),
      makePattern({ id: "p2", pattern: "Another pattern" }),
    ]);
    expect(result).toContain("1.");
    expect(result).toContain("2.");
  });
});
