import { describe, it, expect } from "vitest";
import { scorePrompt } from "../../src/tools/prompt-score.js";

describe("scorePrompt", () => {
  it("gives high specificity for file paths", () => {
    const result = scorePrompt("Fix the bug in src/lib/config.ts where the YAML parser crashes on empty files");
    expect(result.specificity).toBe(25);
  });

  it("gives high specificity for backtick identifiers", () => {
    const result = scorePrompt("Rename `loadConfig` to `initConfig`");
    expect(result.specificity).toBe(25);
  });

  it("gives medium specificity for generic references", () => {
    const result = scorePrompt("Fix the component that handles auth");
    expect(result.specificity).toBe(15);
  });

  it("gives low specificity for vague prompts", () => {
    const result = scorePrompt("make it work");
    expect(result.specificity).toBe(5);
  });

  it("gives high scope for bounded tasks", () => {
    const result = scorePrompt("Only update the return type of this single function");
    expect(result.scope).toBe(25);
  });

  it("penalizes unbounded scope", () => {
    const result = scorePrompt("Fix all the bugs");
    expect(result.scope).toBe(10);
    expect(result.feedback.some(f => f.includes("broad"))).toBe(true);
  });

  it("gives high actionability for specific verbs", () => {
    const result = scorePrompt("Extract the validation logic into a separate function");
    expect(result.actionability).toBe(25);
  });

  it("gives medium actionability for vague verbs", () => {
    const result = scorePrompt("Make the auth flow work better");
    expect(result.actionability).toBe(15);
  });

  it("gives high done-condition for verifiable outcomes", () => {
    const result = scorePrompt("Fix the function so it should return null instead of throwing");
    expect(result.doneCondition).toBe(25);
  });

  it("gives good done-condition for questions", () => {
    const result = scorePrompt("Why is the login page redirecting to a 404?");
    expect(result.doneCondition).toBe(20);
  });

  it("grades A+ for excellent prompts", () => {
    const result = scorePrompt(
      "Rename `loadConfig` in `src/lib/config.ts` to `initConfig` — only this single function. " +
      "The tests in `tests/lib/config.test.ts` should still pass after the rename."
    );
    expect(result.total).toBeGreaterThanOrEqual(90);
    expect(result.grade).toBe("A+");
  });

  it("grades poorly for vague prompts", () => {
    const result = scorePrompt("fix it");
    expect(result.total).toBeLessThanOrEqual(45);
    expect(["D", "F"]).toContain(result.grade);
  });

  it("provides improvement feedback for weak prompts", () => {
    const result = scorePrompt("fix it");
    expect(result.feedback.length).toBeGreaterThan(0);
    expect(result.feedback.some(f => f.includes("📁"))).toBe(true);
  });

  it("provides congratulatory feedback for perfect prompts", () => {
    const result = scorePrompt(
      "Add only a `validateEmail` function to `src/lib/validators.ts` that should return true for valid emails and nothing else"
    );
    // All dimensions maxed → no improvement tips → congratulatory message
    expect(result.total).toBe(100);
    expect(result.feedback.some(f => f.includes("🏆"))).toBe(true);
  });

  it("returns scores that sum to total", () => {
    const result = scorePrompt("Refactor the auth module to extract token refresh logic");
    expect(result.specificity + result.scope + result.actionability + result.doneCondition).toBe(result.total);
  });
});
