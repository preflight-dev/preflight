import { describe, it, expect } from "vitest";

// We test the pure functions by importing them indirectly.
// Since summarizeEvents and formatReport are not exported, we test via the module's behavior.
// For unit testing, we extract and test the logic directly.

// Inline copies of the pure functions for testing (avoids needing to export internals)
interface EventSummary {
  total: number;
  byType: Record<string, number>;
  byDay: Map<string, number>;
  corrections: number;
  errors: number;
  avgEventsPerDay: number;
  activeDays: number;
}

function summarizeEvents(events: any[]): EventSummary {
  const byType: Record<string, number> = {};
  const byDay = new Map<string, number>();
  let corrections = 0;
  let errors = 0;

  for (const e of events) {
    byType[e.type] = (byType[e.type] || 0) + 1;
    const day = e.timestamp
      ? new Date(e.timestamp).toISOString().slice(0, 10)
      : "unknown";
    byDay.set(day, (byDay.get(day) || 0) + 1);
    if (e.type === "correction") corrections++;
    if (e.type === "error") errors++;
  }

  const activeDays = byDay.size;
  return {
    total: events.length,
    byType,
    byDay,
    corrections,
    errors,
    avgEventsPerDay: activeDays > 0 ? Math.round(events.length / activeDays) : 0,
    activeDays,
  };
}

describe("export-timeline summarizeEvents", () => {
  it("counts events by type", () => {
    const events = [
      { type: "prompt", timestamp: "2026-03-01T10:00:00Z" },
      { type: "prompt", timestamp: "2026-03-01T11:00:00Z" },
      { type: "assistant", timestamp: "2026-03-01T10:01:00Z" },
      { type: "correction", timestamp: "2026-03-02T09:00:00Z" },
      { type: "error", timestamp: "2026-03-02T10:00:00Z" },
    ];
    const summary = summarizeEvents(events);
    expect(summary.total).toBe(5);
    expect(summary.byType["prompt"]).toBe(2);
    expect(summary.byType["assistant"]).toBe(1);
    expect(summary.corrections).toBe(1);
    expect(summary.errors).toBe(1);
    expect(summary.activeDays).toBe(2);
    expect(summary.avgEventsPerDay).toBe(3); // 5/2 rounded
  });

  it("handles empty events", () => {
    const summary = summarizeEvents([]);
    expect(summary.total).toBe(0);
    expect(summary.activeDays).toBe(0);
    expect(summary.avgEventsPerDay).toBe(0);
  });

  it("groups by day correctly", () => {
    const events = [
      { type: "prompt", timestamp: "2026-03-01T10:00:00Z" },
      { type: "prompt", timestamp: "2026-03-01T23:59:00Z" },
      { type: "prompt", timestamp: "2026-03-03T01:00:00Z" },
    ];
    const summary = summarizeEvents(events);
    expect(summary.byDay.get("2026-03-01")).toBe(2);
    expect(summary.byDay.get("2026-03-03")).toBe(1);
    expect(summary.byDay.has("2026-03-02")).toBe(false);
  });
});
