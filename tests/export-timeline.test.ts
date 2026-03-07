import { describe, it, expect, vi } from "vitest";
import {
  computeStats,
  generateMarkdownReport,
  parseRelativeDate,
  registerExportTimeline,
} from "../src/tools/export-timeline.js";

describe("parseRelativeDate", () => {
  it("parses '7days' into a date ~7 days ago", () => {
    const result = parseRelativeDate("7days");
    const parsed = new Date(result);
    const now = new Date();
    const diffMs = now.getTime() - parsed.getTime();
    const diffDays = diffMs / (1000 * 60 * 60 * 24);
    expect(diffDays).toBeCloseTo(7, 0);
  });

  it("parses '2weeks' into a date ~14 days ago", () => {
    const result = parseRelativeDate("2weeks");
    const parsed = new Date(result);
    const diffDays =
      (new Date().getTime() - parsed.getTime()) / (1000 * 60 * 60 * 24);
    expect(diffDays).toBeCloseTo(14, 0);
  });

  it("parses '1month' into roughly a month ago", () => {
    const result = parseRelativeDate("1month");
    const parsed = new Date(result);
    expect(parsed.getTime()).toBeLessThan(new Date().getTime());
  });

  it("returns non-matching strings unchanged", () => {
    expect(parseRelativeDate("2024-01-01")).toBe("2024-01-01");
    expect(parseRelativeDate("not-a-date")).toBe("not-a-date");
  });

  it("handles singular units (1day, 1week)", () => {
    const day = parseRelativeDate("1day");
    expect(new Date(day).getTime()).toBeLessThan(Date.now());
    const week = parseRelativeDate("1week");
    expect(new Date(week).getTime()).toBeLessThan(new Date(day).getTime());
  });
});

describe("computeStats", () => {
  const events = [
    { type: "prompt", timestamp: "2026-03-01T10:00:00Z" },
    { type: "assistant", timestamp: "2026-03-01T10:01:00Z" },
    { type: "commit", timestamp: "2026-03-01T11:00:00Z" },
    { type: "correction", timestamp: "2026-03-02T09:00:00Z" },
    { type: "error", timestamp: "2026-03-02T10:00:00Z" },
    { type: "prompt", timestamp: "2026-03-02T11:00:00Z" },
  ];

  it("counts total events", () => {
    const stats = computeStats(events);
    expect(stats.totalEvents).toBe(6);
  });

  it("counts by type", () => {
    const stats = computeStats(events);
    expect(stats.byType["prompt"]).toBe(2);
    expect(stats.byType["assistant"]).toBe(1);
    expect(stats.byType["commit"]).toBe(1);
  });

  it("counts corrections, errors, commits", () => {
    const stats = computeStats(events);
    expect(stats.corrections).toBe(1);
    expect(stats.errors).toBe(1);
    expect(stats.commits).toBe(1);
  });

  it("groups by day", () => {
    const stats = computeStats(events);
    expect(stats.byDay.get("2026-03-01")).toBe(3);
    expect(stats.byDay.get("2026-03-02")).toBe(3);
  });

  it("calculates avg events per day", () => {
    const stats = computeStats(events);
    expect(stats.avgEventsPerDay).toBe(3);
  });

  it("handles empty events", () => {
    const stats = computeStats([]);
    expect(stats.totalEvents).toBe(0);
    expect(stats.avgEventsPerDay).toBe(0);
    expect(stats.byDay.size).toBe(0);
  });

  it("handles events without timestamps", () => {
    const stats = computeStats([{ type: "prompt" }]);
    expect(stats.byDay.get("unknown")).toBe(1);
  });
});

describe("generateMarkdownReport", () => {
  const events = [
    { type: "prompt", timestamp: "2026-03-01T10:00:00Z" },
    { type: "commit", timestamp: "2026-03-01T11:00:00Z", commit_hash: "abc1234def", content: "fix: resolve parsing bug" },
    { type: "error", timestamp: "2026-03-01T12:00:00Z", content: "TypeError: cannot read property" },
    { type: "correction", timestamp: "2026-03-01T13:00:00Z", content: "User corrected approach" },
  ];
  const stats = computeStats(events);

  it("includes project name and period in header", () => {
    const report = generateMarkdownReport(events, stats, {
      project: "my-project",
      period: "week",
    });
    expect(report).toContain("# Session Report: my-project");
    expect(report).toContain("Period: week");
  });

  it("includes summary table", () => {
    const report = generateMarkdownReport(events, stats, {
      project: "test",
      period: "day",
    });
    expect(report).toContain("Total events | 4");
    expect(report).toContain("Commits | 1");
  });

  it("includes commit hashes truncated to 7 chars", () => {
    const report = generateMarkdownReport(events, stats, {
      project: "test",
      period: "day",
    });
    expect(report).toContain("`abc1234`");
    expect(report).not.toContain("abc1234def");
  });

  it("includes corrections section when corrections exist", () => {
    const report = generateMarkdownReport(events, stats, {
      project: "test",
      period: "day",
    });
    expect(report).toContain("## Corrections");
    expect(report).toContain("User corrected approach");
  });

  it("includes errors section when errors exist", () => {
    const report = generateMarkdownReport(events, stats, {
      project: "test",
      period: "day",
    });
    expect(report).toContain("## Errors");
    expect(report).toContain("TypeError: cannot read property");
  });

  it("includes daily activity with bar chart", () => {
    const report = generateMarkdownReport(events, stats, {
      project: "test",
      period: "day",
    });
    expect(report).toContain("## Daily Activity");
    expect(report).toContain("█");
  });

  it("omits corrections section when none exist", () => {
    const noCorrections = events.filter((e) => e.type !== "correction");
    const s = computeStats(noCorrections);
    const report = generateMarkdownReport(noCorrections, s, {
      project: "test",
      period: "day",
    });
    expect(report).not.toContain("## Corrections");
  });
});

describe("registerExportTimeline", () => {
  it("is a function", () => {
    expect(typeof registerExportTimeline).toBe("function");
  });
});
