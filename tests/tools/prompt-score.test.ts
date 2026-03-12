import { describe, it, expect } from "vitest";
import { scorePrompt } from "../../src/tools/prompt-score.js";

describe("scorePrompt", () => {
  it("gives high specificity for file paths", () => {
    const result = scorePrompt("Fix the bug in src/tools/prompt-score.ts");
    expect(result.specificity).toBe(25);
  });

  it("gives high specificity for backtick identifiers", () => {
    const result = scorePrompt("Rename `scorePrompt` to `evaluatePrompt`");
    expect(result.specificity).toBe(25);
  });

  it("gives medium specificity for generic terms", () => {
    const result = scorePrompt("Fix the component");
    expect(result.specificity).toBe(15);
  });

  it("gives low specificity for vague prompts", () => {
    const result = scorePrompt("Make it work");
    expect(result.specificity).toBe(5);
  });

  it("gives high scope for bounded keywords", () => {
    const result = scorePrompt("Only update the return type");
    expect(result.actionability).toBeGreaterThan(0);
    expect(result.scope).toBe(25);
  });

  it("gives medium scope for long prompts without scope keywords", () => {
    const longPrompt = "I need you to look at the authentication flow and figure out why the tokens are expiring too quickly and causing users to get logged out repeatedly during their session";
    const result = scorePrompt(longPrompt);
    expect(result.scope).toBe(20);
  });

  it("penalizes unbounded scope keywords", () => {
    const result = scorePrompt("Fix all the bugs");
    expect(result.scope).toBe(10);
  });

  it("gives high actionability for specific verbs", () => {
    const result = scorePrompt("Extract the validation logic into a helper");
    expect(result.actionability).toBe(25);
  });

  it("gives medium actionability for vague verbs", () => {
    const result = scorePrompt("Make the login page work better");
    expect(result.actionability).toBe(15);
  });

  it("gives high done-condition for outcome words", () => {
    const result = scorePrompt("Fix the test so it should return 200");
    expect(result.doneCondition).toBe(25);
  });

  it("gives decent done-condition for questions", () => {
    const result = scorePrompt("Why is the build failing?");
    expect(result.doneCondition).toBe(20);
  });

  it("grades A+ for excellent prompts", () => {
    const result = scorePrompt(
      "Rename only the `validateToken` function in src/auth/tokens.ts — it should return a Result type instead of throwing"
    );
    expect(result.total).toBeGreaterThanOrEqual(90);
    expect(result.grade).toBe("A+");
  });

  it("grades poorly for vague prompts", () => {
    const result = scorePrompt("do stuff");
    expect(result.total).toBeLessThan(45);
    expect(result.grade).toBe("F");
  });

  it("returns feedback suggestions for weak areas", () => {
    const result = scorePrompt("do stuff");
    expect(result.feedback.length).toBeGreaterThan(0);
    expect(result.feedback.some(f => f.includes("📁"))).toBe(true);
  });

  it("returns praise for excellent prompts", () => {
    const result = scorePrompt(
      "Rename only the `validateToken` function in src/auth/tokens.ts — it should return a Result type"
    );
    expect(result.feedback.some(f => f.includes("🏆"))).toBe(true);
  });

  it("total is sum of all dimensions", () => {
    const result = scorePrompt("Fix the bug in src/app.ts");
    expect(result.total).toBe(
      result.specificity + result.scope + result.actionability + result.doneCondition
    );
  });
});
