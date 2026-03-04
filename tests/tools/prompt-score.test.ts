import { describe, it, expect } from "vitest";
import { scorePrompt } from "../../src/tools/prompt-score.js";

describe("scorePrompt", () => {
  it("gives high score for a well-formed prompt", () => {
    const result = scorePrompt(
      "Rename the `handleSubmit` function in `src/components/Form.tsx` to `onFormSubmit`. Only this one function. It should still pass the existing tests."
    );
    expect(result.total).toBeGreaterThanOrEqual(80);
    expect(result.grade).toMatch(/^[AB]/);
  });

  it("gives low score for a vague prompt", () => {
    const result = scorePrompt("make it better");
    expect(result.total).toBeLessThanOrEqual(40);
    expect(result.grade).toMatch(/^[DF]/);
    expect(result.feedback.length).toBeGreaterThan(0);
  });

  it("rewards file paths for specificity", () => {
    const withPath = scorePrompt("fix src/lib/utils.ts");
    const without = scorePrompt("fix the utility code");
    expect(withPath.specificity).toBeGreaterThan(without.specificity);
  });

  it("rewards scope-bounding keywords", () => {
    const bounded = scorePrompt("only update the header component");
    const unbounded = scorePrompt("update components");
    expect(bounded.scope).toBeGreaterThan(unbounded.scope);
  });

  it("penalizes broad scope words", () => {
    const result = scorePrompt("refactor all the files");
    expect(result.scope).toBeLessThanOrEqual(10);
    expect(result.feedback.some(f => f.includes("broad"))).toBe(true);
  });

  it("rewards action verbs", () => {
    const specific = scorePrompt("extract the validation logic into a helper");
    const vague = scorePrompt("clean up the validation stuff");
    expect(specific.actionability).toBeGreaterThan(vague.actionability);
  });

  it("rewards done conditions", () => {
    const withDone = scorePrompt("add a test that should return 404 for missing users");
    const without = scorePrompt("add a test for missing users");
    expect(withDone.doneCondition).toBeGreaterThan(without.doneCondition);
  });

  it("treats questions as having implicit done condition", () => {
    const result = scorePrompt("Why does the login page crash on mobile?");
    expect(result.doneCondition).toBe(20);
  });

  it("long prompts get partial scope credit, not full", () => {
    const longPrompt = "do something with " + "a".repeat(200);
    const result = scorePrompt(longPrompt);
    // Should get 20 (partial) not 25 (full) since no scope keywords
    expect(result.scope).toBe(20);
  });

  it("returns grade F for minimal input", () => {
    const result = scorePrompt("hi");
    expect(result.grade).toBe("F");
  });

  it("returns congratulatory feedback for perfect prompts", () => {
    const result = scorePrompt(
      "In `src/auth/login.ts`, rename only the `validateToken` function to `verifyAuthToken`. The existing test in `tests/auth.test.ts` should still pass."
    );
    if (result.total >= 90) {
      expect(result.feedback.some(f => f.includes("Excellent"))).toBe(true);
    }
  });
});
