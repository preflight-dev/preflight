import { describe, it, expect } from "vitest";
import {
  escapeSQL,
  isValidEventType,
  isValidTimestamp,
  buildWhereFilter,
  EVENT_TYPES,
} from "../../src/lib/timeline-db.js";

describe("escapeSQL", () => {
  it("escapes single quotes", () => {
    expect(escapeSQL("it's")).toBe("it''s");
  });

  it("escapes multiple single quotes", () => {
    expect(escapeSQL("it's a 'test'")).toBe("it''s a ''test''");
  });

  it("passes through safe strings", () => {
    expect(escapeSQL("hello world")).toBe("hello world");
  });

  it("handles empty string", () => {
    expect(escapeSQL("")).toBe("");
  });
});

describe("isValidEventType", () => {
  it("accepts all valid event types", () => {
    for (const t of EVENT_TYPES) {
      expect(isValidEventType(t)).toBe(true);
    }
  });

  it("rejects invalid types", () => {
    expect(isValidEventType("invalid")).toBe(false);
    expect(isValidEventType("' OR 1=1 --")).toBe(false);
    expect(isValidEventType("")).toBe(false);
  });
});

describe("isValidTimestamp", () => {
  it("accepts valid ISO timestamps", () => {
    expect(isValidTimestamp("2024-01-15")).toBe(true);
    expect(isValidTimestamp("2024-01-15T10:30:00Z")).toBe(true);
    expect(isValidTimestamp("2024-01-15T10:30:00.123Z")).toBe(true);
    expect(isValidTimestamp("2024-01-15T10:30:00+05:30")).toBe(true);
    expect(isValidTimestamp("2024-01-15T10:30:00-08:00")).toBe(true);
  });

  it("rejects invalid timestamps", () => {
    expect(isValidTimestamp("not-a-date")).toBe(false);
    expect(isValidTimestamp("' OR 1=1 --")).toBe(false);
    expect(isValidTimestamp("2024/01/15")).toBe(false);
    expect(isValidTimestamp("")).toBe(false);
  });
});

describe("buildWhereFilter", () => {
  it("returns undefined for empty options", () => {
    expect(buildWhereFilter({})).toBeUndefined();
  });

  it("builds single project filter", () => {
    expect(buildWhereFilter({ project: "/my/project" })).toBe(
      "project = '/my/project'"
    );
  });

  it("escapes quotes in project path", () => {
    expect(buildWhereFilter({ project: "it's/a/path" })).toBe(
      "project = 'it''s/a/path'"
    );
  });

  it("escapes quotes in branch name", () => {
    expect(buildWhereFilter({ branch: "fix/it's-broken" })).toBe(
      "branch = 'fix/it''s-broken'"
    );
  });

  it("combines multiple filters with AND", () => {
    const result = buildWhereFilter({
      project: "/proj",
      branch: "main",
      type: "prompt",
    });
    expect(result).toBe(
      "project = '/proj' AND branch = 'main' AND type = 'prompt'"
    );
  });

  it("throws on invalid event type", () => {
    expect(() => buildWhereFilter({ type: "malicious' OR 1=1 --" as any })).toThrow(
      "Invalid event type"
    );
  });

  it("throws on invalid since timestamp", () => {
    expect(() => buildWhereFilter({ since: "'; DROP TABLE events; --" })).toThrow(
      "Invalid timestamp"
    );
  });

  it("throws on invalid until timestamp", () => {
    expect(() => buildWhereFilter({ until: "not-a-date" })).toThrow(
      "Invalid timestamp"
    );
  });

  it("accepts valid timestamp range", () => {
    const result = buildWhereFilter({
      since: "2024-01-01T00:00:00Z",
      until: "2024-12-31T23:59:59Z",
    });
    expect(result).toBe(
      "timestamp >= '2024-01-01T00:00:00Z' AND timestamp <= '2024-12-31T23:59:59Z'"
    );
  });
});
