import { describe, it, expect } from "vitest";
import { extractSignals } from "../../src/tools/clarify-intent.js";

const defaultCtx = { hasTypeErrors: false, hasTestFailures: false, hasDirtyFiles: false };

describe("extractSignals", () => {
  it("returns UNCLEAR for messages with no recognized patterns", () => {
    const signals = extractSignals("hello world", defaultCtx);
    expect(signals).toEqual(["UNCLEAR: Ask ONE clarifying question before proceeding."]);
  });

  it("detects FIX intent", () => {
    const signals = extractSignals("fix the broken login", defaultCtx);
    expect(signals.some(s => s.startsWith("FIX:"))).toBe(true);
  });

  it("adds type error hint when FIX + type errors present", () => {
    const signals = extractSignals("fix errors", { ...defaultCtx, hasTypeErrors: true });
    expect(signals.some(s => s.includes("Type errors detected"))).toBe(true);
  });

  it("adds test failure hint when FIX + test failures present", () => {
    const signals = extractSignals("fix the bug", { ...defaultCtx, hasTestFailures: true });
    expect(signals.some(s => s.includes("Test failures detected"))).toBe(true);
  });

  it("suggests asking what's broken when FIX but no errors/failures", () => {
    const signals = extractSignals("fix it", defaultCtx);
    expect(signals.some(s => s.includes("ask what's broken"))).toBe(true);
  });

  it("detects TEST intent", () => {
    const signals = extractSignals("run the test suite", defaultCtx);
    expect(signals.some(s => s.startsWith("TESTS:"))).toBe(true);
  });

  it("detects TEST intent for plural 'tests'", () => {
    const signals = extractSignals("run the tests", defaultCtx);
    expect(signals.some(s => s.startsWith("TESTS:"))).toBe(true);
  });

  it("detects TEST intent for plural 'specs'", () => {
    const signals = extractSignals("check the specs", defaultCtx);
    expect(signals.some(s => s.startsWith("TESTS:"))).toBe(true);
  });

  it("detects GIT intent", () => {
    const signals = extractSignals("commit and push", defaultCtx);
    expect(signals.some(s => s.startsWith("GIT:"))).toBe(true);
  });

  it("detects CREATE intent", () => {
    const signals = extractSignals("add a new feature", defaultCtx);
    expect(signals.some(s => s.startsWith("CREATE:"))).toBe(true);
  });

  it("detects REMOVE intent", () => {
    const signals = extractSignals("delete the old module", defaultCtx);
    expect(signals.some(s => s.startsWith("REMOVE:"))).toBe(true);
  });

  it("detects VERIFY intent", () => {
    const signals = extractSignals("check the status", defaultCtx);
    expect(signals.some(s => s.startsWith("VERIFY:"))).toBe(true);
  });

  it("detects REFACTOR intent", () => {
    const signals = extractSignals("refactor the auth module", defaultCtx);
    expect(signals.some(s => s.startsWith("REFACTOR:"))).toBe(true);
  });

  it("detects DEPLOY intent", () => {
    const signals = extractSignals("deploy to production", defaultCtx);
    expect(signals.some(s => s.startsWith("DEPLOY:"))).toBe(true);
  });

  it("warns on unbounded scope", () => {
    const signals = extractSignals("fix everything", defaultCtx);
    expect(signals.some(s => s.includes("UNBOUNDED"))).toBe(true);
  });

  it("detects multiple intents simultaneously", () => {
    const signals = extractSignals("fix and refactor the test suite", defaultCtx);
    expect(signals.some(s => s.startsWith("FIX:"))).toBe(true);
    expect(signals.some(s => s.startsWith("REFACTOR:"))).toBe(true);
    expect(signals.some(s => s.startsWith("TESTS:"))).toBe(true);
  });
});
