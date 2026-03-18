import { describe, it, expect } from "vitest";
import { shell } from "../../src/lib/git.js";

describe("shell()", () => {
  it("runs simple commands", () => {
    const result = shell("echo hello");
    expect(result).toBe("hello");
  });

  it("supports pipes", () => {
    const result = shell("echo 'line1\nline2\nline3' | wc -l");
    expect(parseInt(result.trim())).toBe(3);
  });

  it("supports redirects and ||", () => {
    const result = shell("cat /nonexistent/file 2>/dev/null || echo fallback");
    expect(result).toBe("fallback");
  });

  it("supports && chaining", () => {
    const result = shell("echo first && echo second");
    expect(result).toContain("first");
    expect(result).toContain("second");
  });

  it("returns error string on failure", () => {
    const result = shell("exit 1");
    expect(result).toMatch(/\[command failed/);
  });

  it("respects timeout", () => {
    const result = shell("sleep 10", { timeout: 100 });
    expect(result).toMatch(/timed out/);
  });
});
