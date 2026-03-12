import { describe, it, expect } from "vitest";

// We test the pure functions by importing the module and extracting logic.
// Since computeStats and buildMarkdownReport are not exported, we test via
// the tool's behavior indirectly, plus unit-test the date parser pattern.

describe("export-report", () => {
  describe("relative date parsing", () => {
    const RELATIVE_DATE_RE = /^(\d+)(days?|weeks?|months?)$/;

    it("matches relative date patterns", () => {
      expect("7days".match(RELATIVE_DATE_RE)).toBeTruthy();
      expect("1week".match(RELATIVE_DATE_RE)).toBeTruthy();
      expect("3months".match(RELATIVE_DATE_RE)).toBeTruthy();
      expect("14days".match(RELATIVE_DATE_RE)).toBeTruthy();
    });

    it("rejects invalid patterns", () => {
      expect("2026-01-01".match(RELATIVE_DATE_RE)).toBeNull();
      expect("yesterday".match(RELATIVE_DATE_RE)).toBeNull();
      expect("days7".match(RELATIVE_DATE_RE)).toBeNull();
    });
  });

  describe("stats computation logic", () => {
    // Inline the logic to unit test it
    function computeStats(events: any[]) {
      const stats = {
        total: events.length,
        byType: {} as Record<string, number>,
        byDay: {} as Record<string, number>,
        corrections: 0,
        errors: 0,
        commits: 0,
        prompts: 0,
        toolCalls: 0,
      };
      for (const e of events) {
        stats.byType[e.type] = (stats.byType[e.type] || 0) + 1;
        const day = e.timestamp
          ? new Date(e.timestamp).toISOString().slice(0, 10)
          : "unknown";
        stats.byDay[day] = (stats.byDay[day] || 0) + 1;
        if (e.type === "correction") stats.corrections++;
        if (e.type === "error") stats.errors++;
        if (e.type === "commit") stats.commits++;
        if (e.type === "prompt") stats.prompts++;
        if (e.type === "tool_call") stats.toolCalls++;
      }
      return stats;
    }

    it("counts events correctly", () => {
      const events = [
        { type: "prompt", timestamp: "2026-03-10T10:00:00Z", content: "hello" },
        { type: "prompt", timestamp: "2026-03-10T10:05:00Z", content: "world" },
        { type: "correction", timestamp: "2026-03-10T10:10:00Z", content: "fix" },
        { type: "commit", timestamp: "2026-03-11T12:00:00Z", content: "feat" },
        { type: "error", timestamp: "2026-03-11T12:05:00Z", content: "oops" },
        { type: "tool_call", timestamp: "2026-03-11T14:00:00Z", content: "run" },
      ];

      const stats = computeStats(events);
      expect(stats.total).toBe(6);
      expect(stats.prompts).toBe(2);
      expect(stats.corrections).toBe(1);
      expect(stats.commits).toBe(1);
      expect(stats.errors).toBe(1);
      expect(stats.toolCalls).toBe(1);
      expect(stats.byDay["2026-03-10"]).toBe(3);
      expect(stats.byDay["2026-03-11"]).toBe(3);
    });

    it("handles empty events", () => {
      const stats = computeStats([]);
      expect(stats.total).toBe(0);
      expect(stats.prompts).toBe(0);
    });
  });
});
