import { describe, it, expect } from "vitest";
import {
  computeStats,
  formatPeriodLabel,
  getDateRange,
} from "../../src/tools/export-report.js";

describe("computeStats", () => {
  it("counts all event types correctly", () => {
    const events = [
      { type: "prompt" },
      { type: "prompt" },
      { type: "commit" },
      { type: "correction" },
      { type: "tool_call" },
      { type: "tool_call" },
      { type: "tool_call" },
      { type: "error" },
      { type: "sub_agent_spawn" },
      { type: "compaction" },
      { type: "assistant" },
      { type: "assistant" },
    ];
    const stats = computeStats(events);
    expect(stats).toEqual({
      prompts: 2,
      commits: 1,
      corrections: 1,
      toolCalls: 3,
      errors: 1,
      subAgentSpawns: 1,
      compactions: 1,
      assistantMessages: 2,
    });
  });

  it("returns all zeros for empty array", () => {
    const stats = computeStats([]);
    expect(stats.prompts).toBe(0);
    expect(stats.commits).toBe(0);
    expect(stats.errors).toBe(0);
  });

  it("ignores unknown event types", () => {
    const stats = computeStats([{ type: "unknown" }, { type: "foo" }]);
    expect(stats.prompts).toBe(0);
    expect(stats.commits).toBe(0);
  });
});

describe("formatPeriodLabel", () => {
  it("returns custom range when since and until provided", () => {
    expect(formatPeriodLabel("7days", "2026-01-01", "2026-01-07")).toBe(
      "2026-01-01 to 2026-01-07"
    );
  });

  it("returns human-readable label for known periods", () => {
    expect(formatPeriodLabel("7days")).toBe("Last 7 Days");
    expect(formatPeriodLabel("30days")).toBe("Last 30 Days");
    expect(formatPeriodLabel("24hours")).toBe("Last 24 Hours");
  });

  it("returns raw period string for unknown values", () => {
    expect(formatPeriodLabel("custom")).toBe("custom");
  });
});

describe("getDateRange", () => {
  it("returns ISO date strings", () => {
    const { since, until } = getDateRange("7days");
    expect(() => new Date(since)).not.toThrow();
    expect(() => new Date(until)).not.toThrow();
  });

  it("24hours range is roughly 24h apart", () => {
    const { since, until } = getDateRange("24hours");
    const diff = new Date(until).getTime() - new Date(since).getTime();
    const hours = diff / (1000 * 60 * 60);
    expect(hours).toBeCloseTo(24, 0);
  });

  it("7days range is roughly 7 days apart", () => {
    const { since, until } = getDateRange("7days");
    const diff = new Date(until).getTime() - new Date(since).getTime();
    const days = diff / (1000 * 60 * 60 * 24);
    expect(days).toBeCloseTo(7, 0);
  });

  it("30days range is roughly 30 days apart", () => {
    const { since, until } = getDateRange("30days");
    const diff = new Date(until).getTime() - new Date(since).getTime();
    const days = diff / (1000 * 60 * 60 * 24);
    expect(days).toBeCloseTo(30, 0);
  });

  it("defaults to 7 days for unknown period", () => {
    const { since, until } = getDateRange("unknown");
    const diff = new Date(until).getTime() - new Date(since).getTime();
    const days = diff / (1000 * 60 * 60 * 24);
    expect(days).toBeCloseTo(7, 0);
  });
});
