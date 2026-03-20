import { describe, it, expect } from "vitest";
import { scorePrompt } from "../../src/tools/prompt-score.js";

describe("scorePrompt", () => {
  // ── Specificity ──────────────────────────────────────────────────────
  it("gives max specificity for file paths", () => {
    const r = scorePrompt("Fix the bug in src/tools/prompt-score.ts");
    expect(r.specificity).toBe(25);
  });

  it("gives max specificity for backtick identifiers", () => {
    const r = scorePrompt("Rename `handleClick` to `onClick`");
    expect(r.specificity).toBe(25);
  });

  it("gives partial specificity for generic file/function keywords", () => {
    const r = scorePrompt("Update the component to use hooks");
    expect(r.specificity).toBe(15);
  });

  it("gives low specificity when nothing specific is mentioned", () => {
    const r = scorePrompt("Make it better");
    expect(r.specificity).toBe(5);
  });

  // ── Scope ────────────────────────────────────────────────────────────
  it("gives max scope for bounded tasks", () => {
    const r = scorePrompt("Only change the return type of this function");
    expect(r.scope).toBe(25);
  });

  it("gives lower scope for 'all/every' phrasing", () => {
    const r = scorePrompt("Fix every test");
    expect(r.scope).toBe(10);
  });

  // ── Actionability ────────────────────────────────────────────────────
  it("gives max actionability for specific verbs", () => {
    const r = scorePrompt("Rename the variable x to count");
    expect(r.actionability).toBe(25);
  });

  it("gives partial actionability for vague verbs", () => {
    const r = scorePrompt("Make the tests work");
    expect(r.actionability).toBe(15);
  });

  it("gives low actionability with no verb", () => {
    const r = scorePrompt("the login page");
    expect(r.actionability).toBe(5);
  });

  // ── Done condition ───────────────────────────────────────────────────
  it("gives max done condition for outcome words", () => {
    const r = scorePrompt("Fix it so the test should pass");
    expect(r.doneCondition).toBe(25);
  });

  it("gives good done condition for questions", () => {
    const r = scorePrompt("Why does this throw a TypeError?");
    expect(r.doneCondition).toBe(20);
  });

  it("gives low done condition when no outcome specified", () => {
    const r = scorePrompt("Refactor the code");
    expect(r.doneCondition).toBe(5);
  });

  // ── Grade boundaries ────────────────────────────────────────────────
  it("grades A+ for a perfect prompt", () => {
    // specificity=25 (file path), scope=25 (long+bounded), actionability=25 (verb), doneCondition=25 (outcome)
    const r = scorePrompt(
      "Rename `processData` in src/utils/transform.ts to `transformRecords` — only this one function. The existing tests should still pass."
    );
    expect(r.total).toBe(100);
    expect(r.grade).toBe("A+");
    expect(r.feedback).toContain("🏆 Excellent prompt! Clear target, scope, action, and done condition.");
  });

  it("grades F for a vague prompt", () => {
    const r = scorePrompt("help");
    expect(r.total).toBeLessThan(45);
    expect(r.grade).toBe("F");
  });

  // ── Total is sum of components ───────────────────────────────────────
  it("total equals sum of all four dimensions", () => {
    const r = scorePrompt("Add a test for the `validate` function in src/lib/check.ts");
    expect(r.total).toBe(r.specificity + r.scope + r.actionability + r.doneCondition);
  });

  // ── Feedback is non-empty ────────────────────────────────────────────
  it("always returns at least one feedback item", () => {
    const r = scorePrompt("do stuff");
    expect(r.feedback.length).toBeGreaterThan(0);
  });
});
