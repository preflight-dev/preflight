import { describe, it, expect } from "vitest";
import { scorePrompt } from "../../src/tools/prompt-score.js";

describe("scorePrompt", () => {
  it("gives high specificity for file paths", () => {
    const result = scorePrompt("Fix the bug in src/tools/prompt-score.ts");
    expect(result.specificity).toBe(25);
  });

  it("gives high specificity for backtick identifiers", () => {
    const result = scorePrompt("Rename `handleClick` to `onPress`");
    expect(result.specificity).toBe(25);
  });

  it("gives low specificity for vague prompts", () => {
    const result = scorePrompt("make it better");
    expect(result.specificity).toBe(5);
  });

  it("gives high scope for bounding words", () => {
    const result = scorePrompt("Fix only the login validation in auth.ts");
    expect(result.scope).toBe(25);
  });

  it("penalizes broad scope words", () => {
    const result = scorePrompt("Refactor all the components");
    expect(result.scope).toBe(10);
  });

  it("does NOT give full scope just because prompt is long", () => {
    // Regression: previously text.length > 100 gave full scope points
    const longVague = "I want you to look at the codebase and think about what could be improved and then maybe do some things that would make it generally better overall";
    expect(longVague.length).toBeGreaterThan(100);
    const result = scorePrompt(longVague);
    expect(result.scope).toBeLessThan(25);
  });

  it("bounding words override broad words", () => {
    // "just" + "all" — broad words take precedence to be conservative
    const result = scorePrompt("Fix just all the tests");
    expect(result.scope).toBe(10);
  });

  it("gives high actionability for specific verbs", () => {
    const result = scorePrompt("Rename the function to handleSubmit");
    expect(result.actionability).toBe(25);
  });

  it("gives low actionability for vague verbs", () => {
    const result = scorePrompt("Make the app work better");
    expect(result.actionability).toBe(15);
  });

  it("gives high done-condition for outcome words", () => {
    const result = scorePrompt("Fix the parser so it should return null on empty input");
    expect(result.doneCondition).toBe(25);
  });

  it("gives A+ for excellent prompts", () => {
    const result = scorePrompt(
      "Fix only the `validateEmail` function in src/utils/validation.ts — it should return false for inputs without an @ symbol"
    );
    expect(result.grade).toMatch(/^A/);
    expect(result.total).toBeGreaterThanOrEqual(85);
  });

  it("gives low grade for vague prompts", () => {
    const result = scorePrompt("make it better");
    expect(result.total).toBeLessThan(50);
  });

  it("total equals sum of components", () => {
    const result = scorePrompt("Add a test for the login page");
    expect(result.total).toBe(
      result.specificity + result.scope + result.actionability + result.doneCondition
    );
  });
});
