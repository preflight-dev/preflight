import { describe, it, expect } from "vitest";
import { scorePrompt } from "../src/tools/prompt-score.js";

describe("scorePrompt", () => {
  it("returns high score for specific, scoped, actionable prompt with done condition", () => {
    const result = scorePrompt(
      "Rename the `fetchUser` function in `src/api/users.ts` to `getUser`. Only this file should change.",
    );
    expect(result.total).toBeGreaterThanOrEqual(75);
    expect(result.grade).toMatch(/^[AB]/);
    expect(result.specificity).toBe(25);
    expect(result.actionability).toBe(25);
  });

  it("returns low score for vague prompt", () => {
    const result = scorePrompt("make it better");
    expect(result.total).toBeLessThanOrEqual(45);
    expect(result.feedback.length).toBeGreaterThan(0);
  });

  it("gives full specificity for file paths", () => {
    const result = scorePrompt("look at src/index.ts");
    expect(result.specificity).toBe(25);
  });

  it("gives full specificity for backtick identifiers", () => {
    const result = scorePrompt("check the `handleSubmit` function");
    expect(result.specificity).toBe(25);
  });

  it("gives partial specificity for generic component mentions", () => {
    const result = scorePrompt("update the component");
    expect(result.specificity).toBe(15);
  });

  it("gives full scope for bounded keywords", () => {
    const result = scorePrompt("only change this one file");
    expect(result.scope).toBe(25);
  });

  it("penalises broad scope keywords", () => {
    const result = scorePrompt("fix every bug");
    expect(result.scope).toBe(10);
  });

  it("gives full actionability for specific verbs", () => {
    for (const verb of ["add", "remove", "refactor", "fix", "delete", "test"]) {
      const result = scorePrompt(`${verb} something`);
      expect(result.actionability).toBe(25);
    }
  });

  it("gives partial actionability for vague verbs", () => {
    const result = scorePrompt("make it work");
    expect(result.actionability).toBe(15);
  });

  it("gives full done-condition for outcome words", () => {
    const result = scorePrompt("it should return 42");
    expect(result.doneCondition).toBe(25);
  });

  it("gives done-condition credit for questions", () => {
    const result = scorePrompt("does this compile?");
    expect(result.doneCondition).toBe(20);
  });

  it("assigns correct letter grades", () => {
    // A+ requires 90+
    const perfect = scorePrompt(
      "Fix the `validate` function in `src/lib/auth.ts` — only this file. It should return false for empty strings.",
    );
    expect(perfect.total).toBeGreaterThanOrEqual(90);
    expect(perfect.grade).toBe("A+");
  });

  it("gives praise feedback for perfect prompts", () => {
    const result = scorePrompt(
      "Add a test for `parseDate` in `src/utils.ts`. Only this function. It should return null for invalid input.",
    );
    expect(result.feedback.some((f) => f.includes("🏆"))).toBe(true);
  });

  it("total equals sum of sub-scores", () => {
    const result = scorePrompt("do stuff");
    expect(result.total).toBe(
      result.specificity + result.scope + result.actionability + result.doneCondition,
    );
  });
});
