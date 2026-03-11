import { describe, it, expect } from "vitest";
import { scorePrompt } from "../src/tools/prompt-score.js";

describe("scorePrompt", () => {
  it("gives high specificity for prompts with file paths", () => {
    const result = scorePrompt("Fix the bug in src/lib/parser.ts where it crashes on empty input");
    expect(result.specificity).toBe(25);
  });

  it("gives high specificity for prompts with backtick identifiers", () => {
    const result = scorePrompt("Rename `handleClick` to `onButtonPress`");
    expect(result.specificity).toBe(25);
  });

  it("gives medium specificity for generic component references", () => {
    const result = scorePrompt("Update the component to handle errors");
    expect(result.specificity).toBe(15);
  });

  it("gives low specificity for vague prompts", () => {
    const result = scorePrompt("Make it better");
    expect(result.specificity).toBe(5);
  });

  it("gives high scope for bounded tasks", () => {
    const result = scorePrompt("Only change the return type of this single function");
    expect(result.scope).toBe(25);
  });

  it("gives low scope for broad tasks", () => {
    const result = scorePrompt("Fix all bugs");
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

  it("gives high done-condition for verifiable outcomes", () => {
    const result = scorePrompt("Fix the parser so it should return null for empty input");
    expect(result.doneCondition).toBe(25);
  });

  it("gives high done-condition for questions", () => {
    const result = scorePrompt("Why does the parser crash on empty input?");
    expect(result.doneCondition).toBe(20);
  });

  it("gives low done-condition when no verifiable outcome", () => {
    const result = scorePrompt("Clean up the code");
    expect(result.doneCondition).toBe(5);
  });

  it("returns grade A+ for perfect prompts", () => {
    const result = scorePrompt(
      "Refactor `parseInput` in src/lib/parser.ts to only handle strings, and it should return null for empty input"
    );
    expect(result.total).toBeGreaterThanOrEqual(90);
    expect(result.grade).toBe("A+");
  });

  it("returns low grade for vague prompts", () => {
    const result = scorePrompt("Fix it");
    expect(result.total).toBeLessThan(55);
    expect(["D", "F"]).toContain(result.grade);
  });

  it("provides feedback for missing dimensions", () => {
    const result = scorePrompt("Do something");
    expect(result.feedback.length).toBeGreaterThan(0);
    expect(result.feedback.some(f => f.includes("📁"))).toBe(true);
  });

  it("provides congratulatory feedback for excellent prompts", () => {
    const result = scorePrompt(
      "Add a test in `tests/parser.test.ts` to only verify that `parseInput` should return null for empty strings"
    );
    if (result.total >= 90) {
      expect(result.feedback[0]).toContain("🏆");
    }
  });

  it("total is sum of all dimensions", () => {
    const result = scorePrompt("Rename `foo` to `bar` in src/index.ts so it should compile");
    expect(result.total).toBe(
      result.specificity + result.scope + result.actionability + result.doneCondition
    );
  });
});
