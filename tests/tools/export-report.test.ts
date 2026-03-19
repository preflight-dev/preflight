import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { getDateRange, summarizeEvents, generateMarkdown } from "../../src/tools/export-report.js";

// ── getDateRange ───────────────────────────────────────────────────────────

describe("getDateRange", () => {
  beforeEach(() => {
    // Fix time to 2026-03-19T14:00:00.000Z
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-19T14:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns today range starting at midnight", () => {
    const range = getDateRange("today");
    expect(range.since).toContain("2026-03-19");
    expect(range.until).toContain("2026-03-19");
    expect(range.label).toBe("2026-03-19");
  });

  it("returns yesterday range", () => {
    const range = getDateRange("yesterday");
    expect(range.since).toContain("2026-03-18");
    expect(range.label).toBe("2026-03-18");
  });

  it("returns week range spanning 7 days", () => {
    const range = getDateRange("week");
    expect(range.since).toContain("2026-03-12");
    expect(range.label).toContain("2026-03-12");
    expect(range.label).toContain("2026-03-19");
  });

  it("returns month range", () => {
    const range = getDateRange("month");
    expect(range.since).toContain("2026-02-19");
    expect(range.label).toContain("2026-02-19");
  });

  it("throws on unknown period", () => {
    expect(() => getDateRange("century")).toThrow("Unknown period: century");
  });
});

// ── summarizeEvents ────────────────────────────────────────────────────────

describe("summarizeEvents", () => {
  it("returns zero counts for empty array", () => {
    const summary = summarizeEvents([]);
    expect(summary.total).toBe(0);
    expect(summary.corrections).toBe(0);
    expect(summary.errors).toBe(0);
    expect(summary.commits).toBe(0);
    expect(summary.prompts).toBe(0);
    expect(summary.toolCalls).toBe(0);
  });

  it("counts events by type correctly", () => {
    const events = [
      { type: "prompt", timestamp: "2026-03-19T10:00:00Z" },
      { type: "prompt", timestamp: "2026-03-19T11:00:00Z" },
      { type: "tool_call", timestamp: "2026-03-19T10:30:00Z" },
      { type: "commit", timestamp: "2026-03-19T12:00:00Z" },
      { type: "correction", timestamp: "2026-03-19T12:30:00Z" },
      { type: "error", timestamp: "2026-03-19T13:00:00Z" },
    ];

    const summary = summarizeEvents(events);
    expect(summary.total).toBe(6);
    expect(summary.prompts).toBe(2);
    expect(summary.toolCalls).toBe(1);
    expect(summary.commits).toBe(1);
    expect(summary.corrections).toBe(1);
    expect(summary.errors).toBe(1);
    expect(summary.byType["prompt"]).toBe(2);
  });

  it("groups events by day", () => {
    const events = [
      { type: "prompt", timestamp: "2026-03-18T10:00:00Z" },
      { type: "prompt", timestamp: "2026-03-18T15:00:00Z" },
      { type: "prompt", timestamp: "2026-03-19T10:00:00Z" },
    ];

    const summary = summarizeEvents(events);
    expect(summary.byDay["2026-03-18"]).toBe(2);
    expect(summary.byDay["2026-03-19"]).toBe(1);
  });

  it("handles events without timestamps", () => {
    const events = [{ type: "prompt" }];
    const summary = summarizeEvents(events);
    expect(summary.byDay["unknown"]).toBe(1);
  });
});

// ── generateMarkdown ───────────────────────────────────────────────────────

describe("generateMarkdown", () => {
  const baseSummary = {
    total: 10,
    byType: { prompt: 5, tool_call: 3, commit: 2 },
    byDay: { "2026-03-19": 10 },
    corrections: 1,
    errors: 0,
    commits: 2,
    prompts: 5,
    toolCalls: 3,
  };

  it("includes project name and period label", () => {
    const md = generateMarkdown(baseSummary, "2026-03-19", "my-project", []);
    expect(md).toContain("# Session Report: my-project");
    expect(md).toContain("**Period:** 2026-03-19");
  });

  it("includes overview metrics table", () => {
    const md = generateMarkdown(baseSummary, "week", "proj", []);
    expect(md).toContain("| Total Events | 10 |");
    expect(md).toContain("| Prompts | 5 |");
    expect(md).toContain("| Commits | 2 |");
  });

  it("calculates correction rate as prompt quality", () => {
    const md = generateMarkdown(baseSummary, "week", "proj", []);
    // 1 correction / 5 prompts = 20%
    expect(md).toContain("20.0%");
    expect(md).toContain("Needs Improvement");
  });

  it("shows excellent quality for low correction rate", () => {
    const summary = { ...baseSummary, corrections: 0, prompts: 100 };
    const md = generateMarkdown(summary, "week", "proj", []);
    expect(md).toContain("0.0%");
    expect(md).toContain("Excellent");
  });

  it("includes recent commits section", () => {
    const events = [
      { type: "commit", commit_hash: "abc1234567890", content: "fix: resolve timeout bug", timestamp: "2026-03-19T12:00:00Z" },
    ];
    const md = generateMarkdown(baseSummary, "week", "proj", events);
    expect(md).toContain("## Recent Commits");
    expect(md).toContain("`abc1234`");
    expect(md).toContain("fix: resolve timeout bug");
  });

  it("includes recent errors section", () => {
    const events = [
      { type: "error", content: "ENOENT: file not found", timestamp: "2026-03-19T13:00:00Z" },
    ];
    const md = generateMarkdown({ ...baseSummary, errors: 1 }, "week", "proj", events);
    expect(md).toContain("## Recent Errors");
    expect(md).toContain("ENOENT: file not found");
  });

  it("skips daily activity table for single-day reports", () => {
    const md = generateMarkdown(baseSummary, "today", "proj", []);
    expect(md).not.toContain("## Daily Activity");
  });

  it("shows daily activity table for multi-day reports", () => {
    const summary = {
      ...baseSummary,
      byDay: { "2026-03-18": 4, "2026-03-19": 6 },
    };
    const md = generateMarkdown(summary, "week", "proj", []);
    expect(md).toContain("## Daily Activity");
    expect(md).toContain("2026-03-18");
    expect(md).toContain("2026-03-19");
  });

  it("includes preflight attribution footer", () => {
    const md = generateMarkdown(baseSummary, "week", "proj", []);
    expect(md).toContain("preflight");
    expect(md).toContain("export_report");
  });
});
