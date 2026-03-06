import { describe, it, expect } from "vitest";
import { scorePrompt } from "../../src/tools/prompt-score.js";

describe("scorePrompt", () => {
  it("gives high specificity for file paths", () => {
    const result = scorePrompt("Fix the bug in src/lib/config.ts where getConfig returns undefined");
    expect(result.specificity).toBe(25);
  });

  it("gives high specificity for backtick identifiers", () => {
    const result = scorePrompt("Rename `handleClick` to `onButtonPress`");
    expect(result.specificity).toBe(25);
  });

  it("gives medium specificity for generic references", () => {
    const result = scorePrompt("Update the component to use the new API");
    expect(result.specificity).toBe(15);
  });

  it("gives low specificity for vague prompts", () => {
    const result = scorePrompt("make it better");
    expect(result.specificity).toBe(5);
  });

  it("gives high scope for bounded tasks", () => {
    const result = scorePrompt("Only update the header color in the nav component");
    expect(result.scope).toBe(25);
  });

  it("penalizes broad scope words", () => {
    const result = scorePrompt("Refactor all the tests");
    expect(result.scope).toBe(10);
  });

  it("gives high actionability for specific verbs", () => {
    const result = scorePrompt("Extract the validation logic into a separate function");
    expect(result.actionability).toBe(25);
  });

  it("gives medium actionability for vague verbs", () => {
    const result = scorePrompt("Clean up the code");
    expect(result.actionability).toBe(15);
  });

  it("gives low actionability for no verbs", () => {
    const result = scorePrompt("the login page");
    expect(result.actionability).toBe(5);
  });

  it("gives high done-condition for outcome words", () => {
    const result = scorePrompt("Fix the function so it should return null on empty input");
    expect(result.doneCondition).toBe(25);
  });

  it("gives medium done-condition for questions", () => {
    const result = scorePrompt("Why is this failing?");
    expect(result.doneCondition).toBe(20);
  });

  it("gives low done-condition when no outcome specified", () => {
    const result = scorePrompt("refactor the code");
    expect(result.doneCondition).toBe(5);
  });

  it("assigns correct letter grades", () => {
    // High-quality prompt: specific file, bounded, action verb, outcome
    const excellent = scorePrompt(
      "Fix only the `parseDate` function in src/utils/date.ts so it should return null for invalid strings"
    );
    expect(excellent.total).toBeGreaterThanOrEqual(90);
    expect(excellent.grade).toBe("A+");

    // Terrible prompt
    const bad = scorePrompt("stuff");
    expect(bad.total).toBeLessThanOrEqual(30);
    expect(bad.grade).toBe("F");
  });

  it("provides feedback for each low-scoring dimension", () => {
    const result = scorePrompt("do stuff");
    expect(result.feedback.length).toBeGreaterThan(0);
    expect(result.feedback.some((f) => f.includes("📁"))).toBe(true); // specificity
  });

  it("congratulates on perfect prompts", () => {
    const result = scorePrompt(
      "Fix only the `parseDate` function in src/utils/date.ts so it should return null for invalid strings"
    );
    expect(result.feedback.some((f) => f.includes("🏆"))).toBe(true);
  });

  it("total equals sum of dimensions", () => {
    const result = scorePrompt("Add a test for the login component");
    expect(result.total).toBe(
      result.specificity + result.scope + result.actionability + result.doneCondition
    );
  });
});
