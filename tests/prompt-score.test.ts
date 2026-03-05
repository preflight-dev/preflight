import { describe, it, expect } from "vitest";
import { scorePrompt } from "../src/tools/prompt-score.js";

describe("scorePrompt", () => {
  it("gives high score to a specific, scoped, actionable prompt with done condition", () => {
    const result = scorePrompt(
      "Rename the `handleClick` function in `src/components/Button.tsx` to `onButtonPress`. It should pass the existing tests."
    );
    expect(result.grade).toMatch(/^[AB]/);
    expect(result.specificity).toBe(25);
    expect(result.actionability).toBe(25);
    expect(result.doneCondition).toBe(25);
  });

  it("gives low score to a vague prompt", () => {
    const result = scorePrompt("make it work");
    expect(result.total).toBeLessThan(50);
    expect(result.grade).toMatch(/^[DF]/);
    expect(result.feedback.length).toBeGreaterThan(0);
  });

  it("penalizes broad scope words like 'all' and 'every'", () => {
    const broad = scorePrompt("fix all the bugs");
    const narrow = scorePrompt("fix only this bug");
    expect(narrow.scope).toBeGreaterThan(broad.scope);
  });

  it("does NOT give full scope score just because prompt is long", () => {
    // This was a bug: text.length > 100 used to grant scope = 25
    const longVague = scorePrompt(
      "I need you to look at the code and figure out what might be going wrong with it because something seems off and I am not sure what the problem is exactly"
    );
    expect(longVague.scope).toBeLessThan(25);
  });

  it("handles mixed scope signals", () => {
    const result = scorePrompt("only update all the test files");
    expect(result.scope).toBe(18);
    expect(result.feedback.some((f) => f.includes("Mixed scope"))).toBe(true);
  });

  it("recognizes file paths as specific", () => {
    const result = scorePrompt("check src/lib/utils.ts");
    expect(result.specificity).toBe(25);
  });

  it("recognizes backtick identifiers as specific", () => {
    const result = scorePrompt("refactor `parseConfig` to use zod");
    expect(result.specificity).toBe(25);
    expect(result.actionability).toBe(25);
  });

  it("gives done-condition credit for questions", () => {
    const result = scorePrompt("Why is `fetchData` broken?");
    expect(result.doneCondition).toBe(20);
  });

  it("gives perfect feedback for an excellent prompt", () => {
    const result = scorePrompt(
      "Add just one test in `tests/auth.test.ts` for the `validateToken` function. It should return false when the token is expired."
    );
    expect(result.feedback).toEqual(["🏆 Excellent prompt! Clear target, scope, action, and done condition."]);
  });

  it("returns numeric total as sum of dimensions", () => {
    const result = scorePrompt("do stuff");
    expect(result.total).toBe(
      result.specificity + result.scope + result.actionability + result.doneCondition
    );
  });
});
