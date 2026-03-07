import { describe, it, expect } from "vitest";
import { scorePrompt } from "../src/tools/prompt-score.js";

describe("scorePrompt", () => {
  it("gives high specificity for file paths", () => {
    const result = scorePrompt("Fix the bug in src/tools/prompt-score.ts where the grade is wrong");
    expect(result.specificity).toBe(25);
  });

  it("gives high specificity for backtick identifiers", () => {
    const result = scorePrompt("Rename `loadHistory` to `getHistory`");
    expect(result.specificity).toBe(25);
  });

  it("gives medium specificity for generic references like 'file'", () => {
    const result = scorePrompt("Update the file with new logic");
    expect(result.specificity).toBe(15);
  });

  it("gives low specificity when no targets mentioned", () => {
    const result = scorePrompt("Make it better");
    expect(result.specificity).toBe(5);
  });

  it("gives high scope for bounded tasks", () => {
    const result = scorePrompt("Only change the header component");
    expect(result.scope).toBe(25);
  });

  it("gives low scope for broad tasks like 'all'", () => {
    const result = scorePrompt("Fix all the bugs");
    expect(result.scope).toBe(10);
  });

  it("gives high actionability for specific verbs", () => {
    const result = scorePrompt("Refactor the auth module");
    expect(result.actionability).toBe(25);
  });

  it("gives medium actionability for vague verbs", () => {
    const result = scorePrompt("Make the auth module work");
    expect(result.actionability).toBe(15);
  });

  it("gives low actionability with no action verb", () => {
    const result = scorePrompt("Auth module");
    expect(result.actionability).toBe(5);
  });

  it("gives high done-condition for verifiable outcomes", () => {
    const result = scorePrompt("Fix the function so it should return an array");
    expect(result.doneCondition).toBe(25);
  });

  it("gives done-condition credit for questions", () => {
    const result = scorePrompt("How does the build pipeline work?");
    expect(result.doneCondition).toBe(20);
  });

  it("gives low done-condition when no outcome specified", () => {
    const result = scorePrompt("Refactor the utils");
    expect(result.doneCondition).toBe(5);
  });

  it("returns A+ for a perfect prompt", () => {
    const result = scorePrompt(
      "Rename the `calculateTotal` function in src/utils/math.ts to `sumLineItems` — only this one function. It should return number[]."
    );
    expect(result.total).toBeGreaterThanOrEqual(90);
    expect(result.grade).toBe("A+");
  });

  it("returns F for a vague prompt", () => {
    const result = scorePrompt("Do stuff");
    expect(result.total).toBeLessThan(45);
    expect(result.grade).toBe("F");
  });

  it("gives no feedback tips for perfect scores", () => {
    const result = scorePrompt(
      "Rename the `calculateTotal` function in src/utils/math.ts to `sumLineItems` — only this one function. It should return number[]."
    );
    expect(result.feedback).toEqual(["🏆 Excellent prompt! Clear target, scope, action, and done condition."]);
  });

  it("total is sum of all dimensions", () => {
    const result = scorePrompt("Fix the bug in `foo` in src/bar.ts, only this function, it should return null");
    expect(result.total).toBe(
      result.specificity + result.scope + result.actionability + result.doneCondition
    );
  });

  it("grade boundaries are correct", () => {
    // Test a few key boundaries via known prompts
    const grades = new Set<string>();
    const prompts = [
      "Do stuff",
      "Fix the thing",
      "Fix the file with new logic",
      "Rename `foo` in src/bar.ts — only this one function. It should return null.",
    ];
    for (const p of prompts) {
      grades.add(scorePrompt(p).grade);
    }
    // Should produce at least 3 distinct grades
    expect(grades.size).toBeGreaterThanOrEqual(3);
  });
});
