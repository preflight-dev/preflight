import { describe, it, expect, vi } from "vitest";
import {
  parseRelativeDate,
  computeStats,
  generateMarkdownReport,
  type TimelineEvent,
} from "../src/tools/export-timeline.js";

describe("parseRelativeDate", () => {
  it("returns ISO strings unchanged", () => {
    expect(parseRelativeDate("2026-01-15T00:00:00Z")).toBe("2026-01-15T00:00:00Z");
  });

  it("parses '7days' as relative", () => {
    const now = new Date();
    const result = new Date(parseRelativeDate("7days"));
    const diff = now.getTime() - result.getTime();
    // Should be ~7 days (allow 1 second tolerance)
    expect(diff).toBeGreaterThan(6.99 * 86400000);
    expect(diff).toBeLessThan(7.01 * 86400000);
  });

  it("parses '1day' singular", () => {
    const result = new Date(parseRelativeDate("1day"));
    const diff = Date.now() - result.getTime();
    expect(diff).toBeGreaterThan(0.99 * 86400000);
    expect(diff).toBeLessThan(1.01 * 86400000);
  });

  it("parses '2weeks'", () => {
    const result = new Date(parseRelativeDate("2weeks"));
    const diff = Date.now() - result.getTime();
    expect(diff).toBeGreaterThan(13.99 * 86400000);
    expect(diff).toBeLessThan(14.01 * 86400000);
  });

  it("parses '1month'", () => {
    const result = new Date(parseRelativeDate("1month"));
    // Just check it's in the past and roughly a month
    expect(result.getTime()).toBeLessThan(Date.now());
  });

  it("parses '1year'", () => {
    const result = new Date(parseRelativeDate("1year"));
    const diff = Date.now() - result.getTime();
    expect(diff).toBeGreaterThan(360 * 86400000);
  });

  it("returns non-matching input as-is", () => {
    expect(parseRelativeDate("garbage")).toBe("garbage");
    expect(parseRelativeDate("")).toBe("");
  });
});

describe("computeStats", () => {
  const events: TimelineEvent[] = [
    { type: "prompt", timestamp: "2026-03-01T10:00:00Z", content: "hello world" },
    { type: "prompt", timestamp: "2026-03-01T11:00:00Z", content: "do something" },
    { type: "commit", timestamp: "2026-03-01T12:00:00Z", content: "fix bug" },
    { type: "error", timestamp: "2026-03-02T09:00:00Z", content: "oops" },
    { type: "tool_call", timestamp: "2026-03-02T10:00:00Z" },
  ];

  it("counts events by type", () => {
    const stats = computeStats(events);
    expect(stats.byType["prompt"]).toBe(2);
    expect(stats.byType["commit"]).toBe(1);
    expect(stats.byType["error"]).toBe(1);
    expect(stats.byType["tool_call"]).toBe(1);
  });

  it("counts events by day", () => {
    const stats = computeStats(events);
    expect(stats.byDay["2026-03-01"]).toBe(3);
    expect(stats.byDay["2026-03-02"]).toBe(2);
  });

  it("calculates average prompt length", () => {
    const stats = computeStats(events);
    expect(stats.promptCount).toBe(2);
    // "hello world" = 11, "do something" = 12, avg = 11.5 → 12 rounded
    expect(stats.avgPromptLen).toBe(12);
  });

  it("handles empty events", () => {
    const stats = computeStats([]);
    expect(stats.byType).toEqual({});
    expect(stats.byDay).toEqual({});
    expect(stats.avgPromptLen).toBe(0);
    expect(stats.promptCount).toBe(0);
  });
});

describe("generateMarkdownReport", () => {
  const events: TimelineEvent[] = [
    { type: "prompt", timestamp: "2026-03-01T10:00:00Z", content: "hello" },
    { type: "commit", timestamp: "2026-03-01T12:00:00Z", content: "initial commit", commit_hash: "abc1234def" },
    { type: "error", timestamp: "2026-03-02T09:00:00Z", content: "something broke" },
    { type: "tool_call", timestamp: "2026-03-02T10:00:00Z", tool_name: "read_file" },
  ];

  it("includes title and date range", () => {
    const report = generateMarkdownReport(events, { project: "/my/project" });
    expect(report).toContain("# Session Report: /my/project");
    expect(report).toContain("2026-03-01");
    expect(report).toContain("2026-03-02");
  });

  it("uses custom title when provided", () => {
    const report = generateMarkdownReport(events, { project: "/my/project", title: "Weekly Report" });
    expect(report).toContain("# Weekly Report");
  });

  it("includes commits section with truncated hash", () => {
    const report = generateMarkdownReport(events, { project: "/p" });
    expect(report).toContain("## Commits");
    expect(report).toContain("`abc1234`");
    expect(report).toContain("initial commit");
  });

  it("includes issues & corrections section", () => {
    const report = generateMarkdownReport(events, { project: "/p" });
    expect(report).toContain("## Issues & Corrections");
    expect(report).toContain("something broke");
  });

  it("includes tool usage breakdown", () => {
    const report = generateMarkdownReport(events, { project: "/p" });
    expect(report).toContain("## Tool Usage");
    expect(report).toContain("read_file");
  });

  it("handles empty events gracefully in report sections", () => {
    const report = generateMarkdownReport(
      [{ type: "prompt", timestamp: "2026-03-01T10:00:00Z", content: "hi" }],
      { project: "/p" }
    );
    expect(report).not.toContain("## Commits");
    expect(report).not.toContain("## Issues & Corrections");
    expect(report).not.toContain("## Tool Usage");
  });
});
