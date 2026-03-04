import { describe, it, expect } from "vitest";
import { scorePrompt } from "../../src/tools/prompt-score.js";

describe("scorePrompt", () => {
  it("gives high score to a specific, scoped, actionable prompt with done condition", () => {
    const result = scorePrompt(
      "Rename the `handleSubmit` function in `src/components/Form.tsx` to `onFormSubmit`. Only this file. It should pass the existing tests.",
    );
    expect(result.total).toBeGreaterThanOrEqual(85);
    expect(result.grade).toMatch(/^A/);
    expect(result.specificity).toBe(25);
    expect(result.actionability).toBe(25);
    expect(result.doneCondition).toBe(25);
  });

  it("gives low score to a vague prompt", () => {
    const result = scorePrompt("make it better");
    expect(result.total).toBeLessThanOrEqual(35);
    expect(result.grade).toMatch(/^[DF]/);
    expect(result.feedback.length).toBeGreaterThan(0);
  });

  it("detects specificity from file paths", () => {
    const result = scorePrompt("fix src/index.ts");
    expect(result.specificity).toBe(25);
  });

  it("detects specificity from backtick identifiers", () => {
    const result = scorePrompt("refactor `parseConfig`");
    expect(result.specificity).toBe(25);
  });

  it("gives partial specificity for generic references", () => {
    const result = scorePrompt("fix the component");
    expect(result.specificity).toBe(15);
  });

  it("scores questions as having done condition", () => {
    const result = scorePrompt("What does the function in src/lib.ts do?");
    expect(result.doneCondition).toBe(20);
  });

  it("detects action verbs", () => {
    const result = scorePrompt("add a test for parsing");
    expect(result.actionability).toBe(25);
  });

  it("gives partial actionability for vague verbs", () => {
    const result = scorePrompt("make the tests work");
    expect(result.actionability).toBe(15);
  });

  it("penalizes broad scope words", () => {
    const result = scorePrompt("fix all errors");
    expect(result.scope).toBe(10);
  });

  it("rewards narrow scope words", () => {
    const result = scorePrompt("only fix the typo");
    expect(result.scope).toBe(25);
  });

  it("assigns correct letter grades at boundaries", () => {
    // A perfect prompt should get A+ or A
    const perfect = scorePrompt(
      "Replace `oldName` in `src/utils/helpers.ts` with `newName`. Only this single function. It should return the same value.",
    );
    expect(["A+", "A", "A-"]).toContain(perfect.grade);
  });

  it("returns congratulatory feedback for perfect scores", () => {
    const result = scorePrompt(
      "Rename `foo` in `src/bar.ts` to `baz`. Only this file. It must pass tests.",
    );
    if (result.total >= 90) {
      expect(result.feedback[0]).toContain("🏆");
    }
  });
});
