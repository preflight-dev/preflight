import { describe, it, expect } from "vitest";
import {
  parseRelativeDate,
  computeStats,
  generateMarkdownReport,
} from "../src/tools/export-timeline.js";

describe("parseRelativeDate", () => {
  it("returns ISO strings as-is", () => {
    expect(parseRelativeDate("2025-01-15T00:00:00Z")).toBe(
      "2025-01-15T00:00:00Z"
    );
  });

  it("parses relative day format", () => {
    const result = parseRelativeDate("7days");
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    const parsed = new Date(result);
    const diff = Date.now() - parsed.getTime();
    // Should be roughly 7 days ago (within a few seconds)
    expect(diff).toBeGreaterThan(6.9 * 86400000);
    expect(diff).toBeLessThan(7.1 * 86400000);
  });

  it("parses singular day", () => {
    const result = parseRelativeDate("1day");
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("parses weeks", () => {
    const result = parseRelativeDate("2weeks");
    const parsed = new Date(result);
    const diff = Date.now() - parsed.getTime();
    expect(diff).toBeGreaterThan(13.9 * 86400000);
    expect(diff).toBeLessThan(14.1 * 86400000);
  });
});

describe("computeStats", () => {
  it("returns zeroes for empty input", () => {
    const stats = computeStats([]);
    expect(stats.total).toBe(0);
    expect(stats.promptCount).toBe(0);
    expect(stats.commitCount).toBe(0);
  });

  it("counts events by type", () => {
    const events = [
      { type: "prompt", timestamp: "2025-01-15T10:00:00Z" },
      { type: "prompt", timestamp: "2025-01-15T11:00:00Z" },
      { type: "commit", timestamp: "2025-01-15T12:00:00Z" },
      { type: "error", timestamp: "2025-01-16T10:00:00Z" },
    ];
    const stats = computeStats(events);
    expect(stats.total).toBe(4);
    expect(stats.promptCount).toBe(2);
    expect(stats.commitCount).toBe(1);
    expect(stats.errorCount).toBe(1);
    expect(stats.byDay.size).toBe(2);
  });

  it("handles events without timestamps", () => {
    const stats = computeStats([{ type: "prompt" }]);
    expect(stats.byDay.has("unknown")).toBe(true);
  });
});

describe("generateMarkdownReport", () => {
  it("generates a report with summary section", () => {
    const events = [
      { type: "prompt", timestamp: "2025-01-15T10:00:00Z", content: "hello" },
      { type: "commit", timestamp: "2025-01-15T12:00:00Z", content: "fix bug", commit_hash: "abc1234def" },
    ];
    const stats = computeStats(events);
    const report = generateMarkdownReport(events, stats, {
      title: "Test Report",
      sections: ["summary"],
    });

    expect(report).toContain("# Test Report");
    expect(report).toContain("Total events | 2");
    expect(report).toContain("Prompts | 1");
    expect(report).toContain("Correction rate:** 0.0%");
  });

  it("handles zero prompts without NaN", () => {
    const events = [
      { type: "commit", timestamp: "2025-01-15T12:00:00Z" },
    ];
    const stats = computeStats(events);
    const report = generateMarkdownReport(events, stats, {
      title: "No Prompts",
      sections: ["summary"],
    });

    expect(report).not.toContain("NaN");
    expect(report).toContain("N/A");
  });

  it("includes commits section with truncated hashes", () => {
    const events = [
      {
        type: "commit",
        timestamp: "2025-01-15T12:00:00Z",
        content: "fix: resolve edge case",
        commit_hash: "abc1234def5678",
      },
    ];
    const stats = computeStats(events);
    const report = generateMarkdownReport(events, stats, {
      title: "Commits",
      sections: ["commits"],
    });

    expect(report).toContain("`abc1234`");
    expect(report).toContain("fix: resolve edge case");
  });

  it("includes date range when provided", () => {
    const report = generateMarkdownReport([], computeStats([]), {
      title: "Ranged",
      since: "7days",
      until: "1day",
      sections: [],
    });

    expect(report).toContain("7days → 1day");
  });
});
