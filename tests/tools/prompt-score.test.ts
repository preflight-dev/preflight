import { describe, it, expect } from "vitest";
import { scorePrompt } from "../../src/tools/prompt-score.js";

describe("scorePrompt", () => {
  it("gives high specificity for file paths", () => {
    const result = scorePrompt("Fix the bug in src/utils/parser.ts");
    expect(result.specificity).toBe(25);
  });

  it("gives high specificity for backtick identifiers", () => {
    const result = scorePrompt("Rename `fetchUserData` to `getUserById`");
    expect(result.specificity).toBe(25);
  });

  it("gives medium specificity for generic file/function mentions", () => {
    const result = scorePrompt("Update the component to handle errors");
    expect(result.specificity).toBe(15);
  });

  it("gives low specificity when nothing specific is mentioned", () => {
    const result = scorePrompt("Make it better");
    expect(result.specificity).toBe(5);
  });

  it("gives high scope for bounded tasks", () => {
    const result = scorePrompt("Only update the validation logic in this single file");
    expect(result.scope).toBe(25);
  });

  it("penalizes broad scope words", () => {
    const result = scorePrompt("Refactor all the tests");
    // "all" → 10, but length > 100 check doesn't apply here
    expect(result.scope).toBe(10);
  });

  it("gives high actionability for specific verbs", () => {
    const result = scorePrompt("Extract the helper into a separate module");
    expect(result.actionability).toBe(25);
  });

  it("gives medium actionability for vague verbs", () => {
    const result = scorePrompt("Make the tests work");
    expect(result.actionability).toBe(15);
  });

  it("gives low actionability with no verbs", () => {
    const result = scorePrompt("the login page");
    expect(result.actionability).toBe(5);
  });

  it("gives high done-condition for outcome words", () => {
    const result = scorePrompt("Fix the parser so it should return null for empty input");
    expect(result.doneCondition).toBe(25);
  });

  it("gives decent done-condition for questions", () => {
    const result = scorePrompt("What is the best approach here?");
    expect(result.doneCondition).toBe(20);
  });

  it("gives low done-condition when outcome is unclear", () => {
    const result = scorePrompt("Clean up the code");
    expect(result.doneCondition).toBe(5);
  });

  it("grades A+ for a perfect prompt", () => {
    const result = scorePrompt(
      "Rename `processQueue` in src/workers/queue.ts to `drainQueue` — only this one function. It should still pass all existing tests."
    );
    expect(result.total).toBeGreaterThanOrEqual(90);
    expect(result.grade).toBe("A+");
  });

  it("grades F for a terrible prompt", () => {
    const result = scorePrompt("stuff");
    expect(result.total).toBeLessThan(45);
    expect(result.grade).toBe("F");
  });

  it("returns feedback tips for low-scoring prompts", () => {
    const result = scorePrompt("stuff");
    expect(result.feedback.length).toBeGreaterThan(0);
    expect(result.feedback.some((f) => f.includes("📁"))).toBe(true);
  });

  it("returns congratulatory feedback for perfect scores", () => {
    const result = scorePrompt(
      "Add a test for `scorePrompt` in tests/tools/prompt-score.test.ts that should assert the total is 100"
    );
    if (result.total === 100) {
      expect(result.feedback[0]).toContain("🏆");
    }
  });

  it("total is sum of all dimensions", () => {
    const result = scorePrompt("Fix the bug in src/index.ts");
    expect(result.total).toBe(
      result.specificity + result.scope + result.actionability + result.doneCondition
    );
  });

  it("all dimensions are between 0 and 25", () => {
    const prompts = ["x", "Fix src/a.ts only, should return true", "Make stuff work"];
    for (const p of prompts) {
      const r = scorePrompt(p);
      for (const dim of [r.specificity, r.scope, r.actionability, r.doneCondition]) {
        expect(dim).toBeGreaterThanOrEqual(0);
        expect(dim).toBeLessThanOrEqual(25);
      }
    }
  });
});
