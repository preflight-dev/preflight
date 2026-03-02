import { describe, it, expect } from "vitest";
import { scorePrompt } from "../src/tools/prompt-score.js";

describe("scorePrompt", () => {
  it("gives high score to specific, actionable prompt with done condition", () => {
    const result = scorePrompt(
      "Rename the `processOrder` function in `src/orders/handler.ts` to `handleOrder`. Tests should still pass."
    );
    expect(result.total).toBeGreaterThanOrEqual(85);
    expect(result.grade).toMatch(/^A/);
    expect(result.specificity).toBe(25); // has file path + backtick identifier
    expect(result.actionability).toBe(25); // "rename"
    expect(result.doneCondition).toBe(25); // "should" + "pass"
  });

  it("gives low score to vague prompt", () => {
    const result = scorePrompt("make it better");
    expect(result.total).toBeLessThanOrEqual(40);
    expect(result.grade).toMatch(/^[DF]/);
    expect(result.feedback.length).toBeGreaterThan(0);
  });

  it("detects action verbs correctly", () => {
    const result = scorePrompt("fix the bug");
    expect(result.actionability).toBe(25);
  });

  it("penalizes vague verbs", () => {
    const result = scorePrompt("make things work");
    expect(result.actionability).toBe(15);
    expect(result.feedback.some(f => f.includes("Vague verb"))).toBe(true);
  });

  it("rewards file paths for specificity", () => {
    const result = scorePrompt("update src/lib/auth.ts");
    expect(result.specificity).toBe(25);
  });

  it("gives partial specificity for generic file references", () => {
    const result = scorePrompt("update the file");
    expect(result.specificity).toBe(15);
  });

  it("flags unbounded scope", () => {
    const result = scorePrompt("fix all the errors");
    expect(result.scope).toBe(10);
  });

  it("rewards bounded scope", () => {
    const result = scorePrompt("only update the header component");
    expect(result.scope).toBe(25);
  });

  it("detects done conditions with should/must/expect", () => {
    const withShould = scorePrompt("change X so it should return 42");
    expect(withShould.doneCondition).toBe(25);

    const withQuestion = scorePrompt("why is this failing?");
    expect(withQuestion.doneCondition).toBe(20);
  });

  it("returns valid grade for every score range", () => {
    // Perfect prompt
    const perfect = scorePrompt(
      "Refactor only the `validate` function in `src/utils/validator.ts` — it should return a boolean"
    );
    expect(["A+", "A", "A-", "B+", "B", "B-", "C+", "C", "D", "F"]).toContain(perfect.grade);

    // Empty prompt
    const empty = scorePrompt("");
    expect(["A+", "A", "A-", "B+", "B", "B-", "C+", "C", "D", "F"]).toContain(empty.grade);
  });

  it("includes congratulatory message for perfect scores", () => {
    const result = scorePrompt(
      "Rename `processOrder` in `src/orders/handler.ts` to `handleOrder`. Only this function. Tests should pass."
    );
    if (result.total >= 90) {
      expect(result.feedback.some(f => f.includes("Excellent"))).toBe(true);
    }
  });
});
