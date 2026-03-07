import { describe, it, expect } from "vitest";
import { scorePrompt } from "../../src/tools/prompt-score.js";

describe("scorePrompt", () => {
  it("gives high score to a specific, scoped, actionable prompt with done condition", () => {
    const result = scorePrompt(
      "Rename the `fetchUser` function in `src/api/users.ts` to `getUser`. Only this one file should change."
    );
    expect(result.total).toBeGreaterThanOrEqual(85);
    expect(result.grade).toMatch(/^A/);
    expect(result.specificity).toBe(25);
    expect(result.scope).toBe(25);
    expect(result.actionability).toBe(25);
  });

  it("gives low score to a vague prompt", () => {
    const result = scorePrompt("make it better");
    expect(result.total).toBeLessThanOrEqual(40);
    expect(result.feedback.length).toBeGreaterThan(0);
  });

  it("does NOT give full scope points just for being long", () => {
    // A long but vague prompt should not get 25/25 scope
    const vagueLong = "I need you to improve the code and make everything work better and also handle more cases and stuff like that and yeah";
    const result = scorePrompt(vagueLong);
    expect(result.scope).toBeLessThan(25);
  });

  it("detects scope-narrowing words", () => {
    const result = scorePrompt("only update the header component");
    expect(result.scope).toBe(25);
  });

  it("penalizes broad scope words", () => {
    const result = scorePrompt("fix every bug in the codebase");
    expect(result.scope).toBe(10);
    expect(result.feedback.some((f) => f.includes("broad"))).toBe(true);
  });

  it("rewards specific file paths", () => {
    const result = scorePrompt("update src/lib/utils.ts");
    expect(result.specificity).toBe(25);
  });

  it("rewards backtick identifiers", () => {
    const result = scorePrompt("refactor `handleSubmit` to use async/await");
    expect(result.specificity).toBe(25);
  });

  it("rewards action verbs", () => {
    const result = scorePrompt("extract the validation logic into a helper");
    expect(result.actionability).toBe(25);
  });

  it("penalizes vague verbs", () => {
    const result = scorePrompt("make the login work");
    expect(result.actionability).toBe(15);
  });

  it("rewards done conditions", () => {
    const result = scorePrompt("add a test that asserts the output includes the user name");
    expect(result.doneCondition).toBe(25);
  });

  it("gives questions decent done-condition score", () => {
    const result = scorePrompt("How is the codebase organized?");
    expect(result.doneCondition).toBe(20);
  });

  it("returns valid grades", () => {
    const validGrades = ["A+", "A", "A-", "B+", "B", "B-", "C+", "C", "D", "F"];
    // Test a range of prompts
    const prompts = [
      "Rename `fetchUser` in `src/api.ts` to `getUser`, only this file should change",
      "fix the bug",
      "make it work",
      "x",
    ];
    for (const p of prompts) {
      const result = scorePrompt(p);
      expect(validGrades).toContain(result.grade);
      expect(result.total).toBeGreaterThanOrEqual(0);
      expect(result.total).toBeLessThanOrEqual(100);
    }
  });
});
