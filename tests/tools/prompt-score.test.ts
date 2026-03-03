import { describe, it, expect } from "vitest";
import { scorePrompt } from "../../src/tools/prompt-score.js";

describe("scorePrompt", () => {
  it("gives high score to well-crafted prompt", () => {
    const result = scorePrompt(
      "Rename the `getUserById` function in `src/lib/users.ts` to `fetchUser` and update only the call sites in this module. It should pass existing tests."
    );
    expect(result.total).toBeGreaterThanOrEqual(80);
    expect(result.grade).toMatch(/^[AB]/);
    expect(result.specificity).toBe(25);
    expect(result.actionability).toBe(25);
  });

  it("gives low score to vague prompt", () => {
    const result = scorePrompt("make it better");
    expect(result.total).toBeLessThanOrEqual(40);
    expect(result.grade).toMatch(/^[DF]/);
    expect(result.feedback.length).toBeGreaterThan(0);
  });

  it("detects file paths for specificity", () => {
    const result = scorePrompt("fix src/index.ts");
    expect(result.specificity).toBe(25);
  });

  it("detects backtick identifiers for specificity", () => {
    const result = scorePrompt("refactor `handleClick` to use async");
    expect(result.specificity).toBe(25);
  });

  it("gives partial specificity for generic type references", () => {
    const result = scorePrompt("update the component");
    expect(result.specificity).toBe(15);
  });

  it("penalizes broad scope words", () => {
    const result = scorePrompt("fix all the bugs");
    expect(result.scope).toBe(10);
    expect(result.feedback.some(f => f.includes("broad"))).toBe(true);
  });

  it("rewards bounded scope words", () => {
    const result = scorePrompt("fix only this specific function");
    expect(result.scope).toBe(25);
  });

  it("does NOT give full scope score just for being long", () => {
    // Regression: previously any prompt >100 chars got scope=25
    const longVague = "I need you to look at the code and think about what could be improved and then maybe do something about it if you think that makes sense to you right now";
    const result = scorePrompt(longVague);
    expect(result.scope).toBeLessThan(25);
  });

  it("rewards specific action verbs", () => {
    const result = scorePrompt("extract the validation logic");
    expect(result.actionability).toBe(25);
  });

  it("gives partial score for vague verbs", () => {
    const result = scorePrompt("improve the code");
    expect(result.actionability).toBe(15);
  });

  it("detects done conditions", () => {
    const result = scorePrompt("it should return null on empty input");
    expect(result.doneCondition).toBe(25);
  });

  it("treats questions as verifiable", () => {
    const result = scorePrompt("why does this function throw on empty input?");
    expect(result.doneCondition).toBe(20);
  });

  it("returns correct grade boundaries", () => {
    // A+ requires ≥90
    const perfect = scorePrompt(
      "Rename only `src/lib/auth.ts` export `validateToken` to `verifyToken`. Tests should pass."
    );
    expect(perfect.total).toBeGreaterThanOrEqual(90);
    expect(perfect.grade).toBe("A+");
  });

  it("gives encouraging feedback on perfect score", () => {
    const result = scorePrompt(
      "Add just one test to `src/utils.test.ts` that asserts `parseDate` returns null for empty string"
    );
    if (result.total >= 90) {
      expect(result.feedback.some(f => f.includes("Excellent"))).toBe(true);
    }
  });
});
