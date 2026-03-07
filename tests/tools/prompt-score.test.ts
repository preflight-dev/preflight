import { describe, it, expect } from "vitest";
import { scorePrompt } from "../../src/tools/prompt-score.js";

describe("scorePrompt", () => {
  it("gives high score for specific, scoped, actionable prompt with done condition", () => {
    const result = scorePrompt(
      "Rename the `getUserById` function in `src/db/users.ts` to `findUserById`. Only this one function. Tests should still pass."
    );
    expect(result.total).toBeGreaterThanOrEqual(80);
    expect(result.specificity).toBe(25);
    expect(result.actionability).toBe(25);
    expect(result.doneCondition).toBe(25);
    expect(result.grade).toMatch(/^[AB]/);
  });

  it("gives low score for vague prompt", () => {
    const result = scorePrompt("fix it");
    expect(result.total).toBeLessThanOrEqual(50);
    expect(result.feedback.length).toBeGreaterThan(0);
    expect(result.grade).toMatch(/^[DFC]/);
  });

  it("rewards file paths in specificity", () => {
    const withPath = scorePrompt("Update src/lib/auth.ts to handle token refresh");
    const without = scorePrompt("Update auth to handle token refresh");
    expect(withPath.specificity).toBeGreaterThan(without.specificity);
  });

  it("rewards backtick identifiers in specificity", () => {
    const result = scorePrompt("Change `handleSubmit` to validate email first");
    expect(result.specificity).toBe(25);
  });

  it("penalizes broad scope words", () => {
    const broad = scorePrompt("Refactor all the components");
    expect(broad.scope).toBeLessThanOrEqual(10);
  });

  it("rewards narrowing words for scope", () => {
    const narrow = scorePrompt("Only update the single header component");
    expect(narrow.scope).toBe(25);
  });

  it("rewards action verbs", () => {
    const good = scorePrompt("Extract the validation logic into a separate function");
    expect(good.actionability).toBe(25);
  });

  it("gives partial credit for vague verbs", () => {
    const vague = scorePrompt("Make the login work better");
    expect(vague.actionability).toBe(15);
  });

  it("rewards done conditions with should/must/expect", () => {
    const result = scorePrompt("The function should return null for invalid IDs");
    expect(result.doneCondition).toBe(25);
  });

  it("gives partial credit for questions", () => {
    const result = scorePrompt("Why is the auth middleware failing?");
    expect(result.doneCondition).toBe(20);
  });

  it("returns congratulatory feedback for perfect prompts", () => {
    const result = scorePrompt(
      "Add a `validateEmail` function in `src/utils/validators.ts` that should return true for valid emails only. Just this one function."
    );
    if (result.total >= 90) {
      expect(result.feedback[0]).toContain("Excellent");
    }
  });

  it("total is sum of four categories", () => {
    const result = scorePrompt("do something");
    expect(result.total).toBe(
      result.specificity + result.scope + result.actionability + result.doneCondition
    );
  });

  it("all scores are within valid ranges", () => {
    const prompts = ["fix bug", "Refactor `src/app.ts` to extract routes. Only the route handlers. Should pass tests."];
    for (const p of prompts) {
      const r = scorePrompt(p);
      expect(r.specificity).toBeGreaterThanOrEqual(0);
      expect(r.specificity).toBeLessThanOrEqual(25);
      expect(r.scope).toBeGreaterThanOrEqual(0);
      expect(r.scope).toBeLessThanOrEqual(25);
      expect(r.actionability).toBeGreaterThanOrEqual(0);
      expect(r.actionability).toBeLessThanOrEqual(25);
      expect(r.doneCondition).toBeGreaterThanOrEqual(0);
      expect(r.doneCondition).toBeLessThanOrEqual(25);
      expect(r.total).toBeGreaterThanOrEqual(0);
      expect(r.total).toBeLessThanOrEqual(100);
    }
  });
});
