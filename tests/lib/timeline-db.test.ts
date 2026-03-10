import { describe, it, expect } from "vitest";
import { escapeSqlString } from "../../src/lib/timeline-db.js";

describe("escapeSqlString", () => {
  it("returns plain strings unchanged", () => {
    expect(escapeSqlString("hello")).toBe("hello");
  });

  it("doubles single quotes", () => {
    expect(escapeSqlString("it's")).toBe("it''s");
    expect(escapeSqlString("a'b'c")).toBe("a''b''c");
  });

  it("strips null bytes", () => {
    expect(escapeSqlString("ab\0cd")).toBe("abcd");
  });

  it("handles both quotes and null bytes", () => {
    expect(escapeSqlString("it\0's")).toBe("it''s");
  });

  it("handles empty string", () => {
    expect(escapeSqlString("")).toBe("");
  });

  it("handles strings with SQL-like content", () => {
    const malicious = "'; DROP TABLE events; --";
    expect(escapeSqlString(malicious)).toBe("''; DROP TABLE events; --");
  });
});
