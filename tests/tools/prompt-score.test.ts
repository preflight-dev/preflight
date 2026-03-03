import { describe, it, expect } from "vitest";
import { scorePrompt } from "../../src/tools/prompt-score.js";

describe("scorePrompt", () => {
  it("gives high score to a well-formed prompt", () => {
    const result = scorePrompt(
      "Rename the `processOrder` function in src/orders/handler.ts to `handleOrder` and update only the call sites in this module. The tests should still pass."
    );
    expect(result.total).toBeGreaterThanOrEqual(80);
    expect(result.grade).toMatch(/^[AB]/);
  });

  it("gives low score to a vague prompt", () => {
    const result = scorePrompt("make it better");
    expect(result.total).toBeLessThanOrEqual(40);
    expect(result.grade).toMatch(/^[DF]/);
    expect(result.feedback.length).toBeGreaterThan(0);
  });

  it("rewards specificity for file paths", () => {
    const withPath = scorePrompt("fix src/index.ts");
    const without = scorePrompt("fix the code");
    expect(withPath.specificity).toBeGreaterThan(without.specificity);
  });

  it("rewards specificity for backtick-quoted identifiers", () => {
    const result = scorePrompt("rename `foo` to `bar`");
    expect(result.specificity).toBe(25);
  });

  it("penalizes broad scope keywords", () => {
    const broad = scorePrompt("refactor every component");
    expect(broad.scope).toBeLessThanOrEqual(10);
    expect(broad.feedback.some((f) => f.includes("broad"))).toBe(true);
  });

  it("gives explicit scope words full marks", () => {
    const result = scorePrompt("update only this function");
    expect(result.scope).toBe(25);
  });

  it("does not give full scope just for being long", () => {
    const longVague = scorePrompt(
      "I want you to go ahead and improve the performance of the application because it has been running really slowly lately and users are complaining about it"
    );
    // Should get partial credit (20) not full (25)
    expect(longVague.scope).toBeLessThan(25);
    expect(longVague.scope).toBeGreaterThanOrEqual(15);
  });

  it("rewards action verbs", () => {
    const good = scorePrompt("extract the validation logic");
    const vague = scorePrompt("handle the validation logic");
    expect(good.actionability).toBeGreaterThan(vague.actionability);
  });

  it("rewards done conditions", () => {
    const result = scorePrompt("add a test that should return 200");
    expect(result.doneCondition).toBe(25);
  });

  it("gives questions partial done-condition credit", () => {
    // Use a question that doesn't contain done-condition keywords
    const result = scorePrompt("what is the best approach here?");
    expect(result.doneCondition).toBe(20);
  });

  it("grade boundaries are correct", () => {
    // A perfect prompt should hit A range
    const perfect = scorePrompt(
      "Fix only the `validate` function in src/lib/validators.ts — it should return false for empty strings"
    );
    expect(perfect.total).toBeGreaterThanOrEqual(85);
  });

  it("returns feedback array even for perfect prompts", () => {
    const result = scorePrompt(
      "Fix only the `validate` function in src/lib/validators.ts — it should return false for empty strings"
    );
    expect(Array.isArray(result.feedback)).toBe(true);
    expect(result.feedback.length).toBeGreaterThan(0);
  });
});
