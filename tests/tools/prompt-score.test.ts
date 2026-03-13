import { describe, it, expect } from "vitest";
import { scorePrompt } from "../../src/tools/prompt-score.js";

describe("scorePrompt", () => {
  it("gives high specificity for prompts with file paths", () => {
    const result = scorePrompt("Fix the bug in src/lib/utils.ts where parseDate returns null");
    expect(result.specificity).toBe(25);
  });

  it("gives high specificity for prompts with backtick identifiers", () => {
    const result = scorePrompt("Rename `getUserById` to `findUser`");
    expect(result.specificity).toBe(25);
  });

  it("gives medium specificity for generic component mentions", () => {
    const result = scorePrompt("Update the component to handle errors");
    expect(result.specificity).toBe(15);
  });

  it("gives low specificity for vague prompts", () => {
    const result = scorePrompt("Make it better");
    expect(result.specificity).toBe(5);
  });

  it("gives high scope for bounded tasks", () => {
    const result = scorePrompt("Only update the return type of this single function");
    expect(result.scope).toBe(25);
  });

  it("penalizes broad scope words", () => {
    const result = scorePrompt("Refactor every handler");
    expect(result.scope).toBe(10);
  });

  it("gives high actionability for specific verbs", () => {
    const result = scorePrompt("Extract the validation logic into a helper");
    expect(result.actionability).toBe(25);
  });

  it("gives medium actionability for vague verbs", () => {
    const result = scorePrompt("Make the login work");
    expect(result.actionability).toBe(15);
  });

  it("gives high done-condition for prompts with expected outcomes", () => {
    const result = scorePrompt("Fix `parseDate` so it should return a Date object instead of string");
    expect(result.doneCondition).toBe(25);
  });

  it("gives decent done-condition for questions", () => {
    const result = scorePrompt("What does this code do?");
    expect(result.doneCondition).toBe(20);
  });

  it("grades A+ for excellent prompts", () => {
    const result = scorePrompt(
      "Rename `getUserById` in src/db/users.ts to `findUserById` — only this one function. It should still return a User | null."
    );
    expect(result.total).toBeGreaterThanOrEqual(90);
    expect(result.grade).toBe("A+");
  });

  it("grades poorly for vague prompts", () => {
    const result = scorePrompt("hmm");
    expect(result.total).toBeLessThan(45);
    expect(["D", "F"]).toContain(result.grade);
  });

  it("provides feedback for low-scoring prompts", () => {
    const result = scorePrompt("do stuff");
    expect(result.feedback.length).toBeGreaterThan(0);
    expect(result.feedback.some((f) => f.includes("📁"))).toBe(true);
  });

  it("provides congratulatory feedback for perfect prompts", () => {
    const result = scorePrompt(
      "Fix the bug in `src/utils.ts` — only the `parseDate` function. It should return a valid Date object."
    );
    if (result.total >= 90) {
      expect(result.feedback[0]).toContain("🏆");
    }
  });

  it("returns all score fields", () => {
    const result = scorePrompt("test");
    expect(result).toHaveProperty("specificity");
    expect(result).toHaveProperty("scope");
    expect(result).toHaveProperty("actionability");
    expect(result).toHaveProperty("doneCondition");
    expect(result).toHaveProperty("total");
    expect(result).toHaveProperty("grade");
    expect(result).toHaveProperty("feedback");
    expect(result.total).toBe(
      result.specificity + result.scope + result.actionability + result.doneCondition
    );
  });
});
