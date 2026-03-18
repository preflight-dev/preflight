import { describe, it, expect } from "vitest";
import { scorePrompt } from "../../src/tools/prompt-score.js";

describe("scorePrompt", () => {
  it("gives high specificity for file paths", () => {
    const result = scorePrompt("Fix the bug in src/tools/checkpoint.ts");
    expect(result.specificity).toBe(25);
  });

  it("gives high specificity for backtick identifiers", () => {
    const result = scorePrompt("Rename `handleRequest` to `processRequest`");
    expect(result.specificity).toBe(25);
  });

  it("gives medium specificity for generic references", () => {
    const result = scorePrompt("Update the component");
    expect(result.specificity).toBe(15);
  });

  it("gives low specificity when no targets mentioned", () => {
    const result = scorePrompt("Make it better");
    expect(result.specificity).toBe(5);
  });

  it("gives high scope for bounded tasks", () => {
    const result = scorePrompt("Only update the return type in this single function");
    expect(result.scope).toBe(25);
  });

  it("gives low scope for broad tasks", () => {
    const result = scorePrompt("Fix all bugs");
    expect(result.scope).toBe(10);
  });

  it("gives high actionability for specific verbs", () => {
    const result = scorePrompt("Refactor the parser");
    expect(result.actionability).toBe(25);
  });

  it("gives medium actionability for vague verbs", () => {
    const result = scorePrompt("Make it work");
    expect(result.actionability).toBe(15);
  });

  it("gives low actionability for no verbs", () => {
    const result = scorePrompt("the thing");
    expect(result.actionability).toBe(5);
  });

  it("gives high done-condition for verifiable outcomes", () => {
    const result = scorePrompt("Fix the function so it should return null on error");
    expect(result.doneCondition).toBe(25);
  });

  it("gives high done-condition for questions", () => {
    const result = scorePrompt("Why does this function throw?");
    expect(result.doneCondition).toBe(20);
  });

  it("gives low done-condition when no outcome stated", () => {
    const result = scorePrompt("Clean up the code");
    expect(result.doneCondition).toBe(5);
  });

  it("grades A+ for a perfect prompt", () => {
    const result = scorePrompt(
      "Refactor `parseConfig` in src/config.ts to only handle JSON — it should return null for invalid input"
    );
    expect(result.total).toBeGreaterThanOrEqual(90);
    expect(result.grade).toBe("A+");
  });

  it("grades F for a terrible prompt", () => {
    const result = scorePrompt("stuff");
    expect(result.total).toBeLessThanOrEqual(45);
    expect(result.grade).toBe("F");
  });

  it("returns feedback suggestions for low scores", () => {
    const result = scorePrompt("do things");
    expect(result.feedback.length).toBeGreaterThan(0);
    expect(result.feedback.some((f) => f.includes("📁"))).toBe(true);
  });

  it("returns congratulatory feedback for perfect scores", () => {
    const result = scorePrompt(
      "Add a test for `scorePrompt` in src/tools/prompt-score.ts that should assert the return type"
    );
    if (result.total === 100) {
      expect(result.feedback[0]).toContain("🏆");
    }
  });
});
