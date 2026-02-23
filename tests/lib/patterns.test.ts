import { describe, it, expect } from "vitest";
import {
  matchPatterns,
  formatPatternMatches,
  type CorrectionPattern,
} from "../../src/lib/patterns.js";

function makePattern(overrides: Partial<CorrectionPattern> = {}): CorrectionPattern {
  return {
    id: "p1",
    pattern: "test pattern",
    keywords: ["auth", "token", "refresh"],
    frequency: 3,
    lastSeen: new Date().toISOString(),
    context: "Auth token refresh was failing silently",
    examples: ["fix auth token", "token refresh broken"],
    ...overrides,
  };
}

describe("matchPatterns", () => {
  it("returns empty array for empty patterns", () => {
    expect(matchPatterns("some prompt", [])).toEqual([]);
  });

  it("returns matching pattern when 2+ keywords match", () => {
    const patterns = [makePattern()];
    const result = matchPatterns("the auth token is broken", patterns);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("p1");
  });

  it("does not match with fewer than 2 keyword hits", () => {
    const patterns = [makePattern()];
    const result = matchPatterns("the auth system is down", patterns);
    expect(result).toHaveLength(0);
  });

  it("returns only matching patterns when multiple exist", () => {
    const patterns = [
      makePattern({ id: "p1", keywords: ["auth", "token", "refresh"] }),
      makePattern({ id: "p2", keywords: ["database", "migration", "schema"] }),
    ];
    const result = matchPatterns("auth token expired again", patterns);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("p1");
  });

  it("matches case-insensitively", () => {
    const patterns = [makePattern({ keywords: ["Auth", "Token", "Refresh"] })];
    const result = matchPatterns("AUTH TOKEN issue", patterns);
    expect(result).toHaveLength(1);
  });
});

describe("formatPatternMatches", () => {
  it("returns empty string for no matches", () => {
    expect(formatPatternMatches([])).toBe("");
  });

  it("returns formatted string with warning header for matches", () => {
    const matches = [makePattern()];
    const result = formatPatternMatches(matches);
    expect(result).toContain("Known patterns matched");
    expect(result).toContain("test pattern");
    expect(result).toContain("corrected 3x");
  });
});
