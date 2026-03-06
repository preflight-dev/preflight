import { describe, it, expect } from "vitest";
import { scorePrompt } from "../../src/tools/prompt-score.js";

describe("scorePrompt", () => {
  it("gives high score to a well-formed prompt", () => {
    const result = scorePrompt(
      "Rename the `handleClick` function in `src/components/Button.tsx` to `onButtonClick`. Only this one file should change. The existing tests must still pass."
    );
    expect(result.total).toBeGreaterThanOrEqual(80);
    expect(result.grade).toMatch(/^[AB]/);
    expect(result.specificity).toBe(25); // has file path + backtick identifiers
    expect(result.actionability).toBe(25); // "rename" is a clear verb
    expect(result.doneCondition).toBe(25); // "must still pass"
  });

  it("gives low score to a vague prompt", () => {
    const result = scorePrompt("make it work");
    expect(result.total).toBeLessThanOrEqual(40);
    expect(result.grade).toMatch(/^[DF]/);
    expect(result.feedback.length).toBeGreaterThan(0);
  });

  it("penalizes broad scope words", () => {
    const result = scorePrompt("Fix all the bugs");
    expect(result.scope).toBeLessThanOrEqual(10);
    expect(result.feedback.some((f) => /scope|narrow/i.test(f))).toBe(true);
  });

  it("rewards bounding words for scope", () => {
    const result = scorePrompt("Fix just this one test");
    expect(result.scope).toBe(25);
  });

  it("does not give max scope just for being long", () => {
    const longVague = "I need you to go ahead and do something about the code because there are some issues and things could be better and it would be nice if they were improved in various ways across the codebase";
    const result = scorePrompt(longVague);
    expect(result.scope).toBeLessThan(25);
  });

  it("scores questions with higher done-condition", () => {
    const result = scorePrompt("How do I configure the `db` connection?");
    expect(result.doneCondition).toBe(20);
  });

  it("gives full specificity for file paths", () => {
    const result = scorePrompt("Update src/index.ts to add logging");
    expect(result.specificity).toBe(25);
  });

  it("gives partial specificity for generic references", () => {
    const result = scorePrompt("Update the file to add logging");
    expect(result.specificity).toBe(15);
  });

  it("returns correct grade boundaries", () => {
    // A+ needs 90+, which requires near-perfect across all dimensions
    const perfect = scorePrompt(
      "Rename only the `validate` function in `src/utils/auth.ts` — the output should return `true` for valid tokens"
    );
    expect(perfect.total).toBeGreaterThanOrEqual(90);
    expect(perfect.grade).toBe("A+");
  });

  it("includes celebration feedback for perfect prompts", () => {
    const result = scorePrompt(
      "Add just one test to `src/lib/math.ts` that asserts `add(1,2)` returns 3"
    );
    if (result.total >= 90) {
      expect(result.feedback.some((f) => /excellent|🏆/i.test(f))).toBe(true);
    }
  });
});
