import { describe, it, expect } from "vitest";
import { getDateRange } from "../../src/lib/date-range.js";

// Fixed reference date: 2025-03-15T12:00:00.000Z (Saturday)
const NOW = new Date("2025-03-15T12:00:00.000Z");

describe("getDateRange", () => {
  it("returns today range starting at midnight", () => {
    const r = getDateRange("today", undefined, undefined, NOW);
    expect(r.since).toContain("2025-03-15");
    expect(r.until).toBe(NOW.toISOString());
    expect(r.label).toBe("2025-03-15");
  });

  it("returns yesterday as full day range", () => {
    const r = getDateRange("yesterday", undefined, undefined, NOW);
    expect(r.since).toContain("2025-03-14");
    expect(r.label).toBe("2025-03-14");
    // until should be end of yesterday (local time)
    const untilDate = new Date(r.until);
    expect(untilDate.getHours()).toBe(23);
    expect(untilDate.getMinutes()).toBe(59);
    // since should be before until
    expect(new Date(r.since).getTime()).toBeLessThan(untilDate.getTime());
  });

  it("returns week range (7 days back)", () => {
    const r = getDateRange("week", undefined, undefined, NOW);
    expect(r.since).toContain("2025-03-08");
    expect(r.until).toBe(NOW.toISOString());
    expect(r.label).toContain("Week of");
  });

  it("returns sprint range (14 days back)", () => {
    const r = getDateRange("sprint", undefined, undefined, NOW);
    expect(r.since).toContain("2025-03-01");
    expect(r.label).toContain("Sprint");
  });

  it("returns month range", () => {
    const r = getDateRange("month", undefined, undefined, NOW);
    expect(r.since).toContain("2025-02-15");
    expect(r.label).toContain("Past month");
  });

  it("handles custom period with both dates", () => {
    const r = getDateRange("custom", "2025-01-01T00:00:00Z", "2025-01-31T23:59:59Z", NOW);
    expect(r.since).toBe("2025-01-01T00:00:00Z");
    expect(r.until).toBe("2025-01-31T23:59:59Z");
    expect(r.label).toBe("2025-01-01 to 2025-01-31");
  });

  it("handles custom period with only since (until defaults to now)", () => {
    const r = getDateRange("custom", "2025-02-01T00:00:00Z", undefined, NOW);
    expect(r.since).toBe("2025-02-01T00:00:00Z");
    expect(r.until).toBe(NOW.toISOString());
  });

  it("falls back to week for unknown period", () => {
    const r = getDateRange("bogus", undefined, undefined, NOW);
    expect(r.since).toContain("2025-03-08");
    expect(r.label).toContain("Week of");
  });

  it("custom without customSince falls back to week", () => {
    const r = getDateRange("custom", undefined, undefined, NOW);
    // No customSince provided, so it should fall through to default (week)
    expect(r.since).toContain("2025-03-08");
  });
});
