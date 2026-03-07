import { describe, it, expect } from "vitest";
import { scorePrompt } from "../src/tools/prompt-score.js";

describe("scorePrompt", () => {
  it("gives high score to a well-formed prompt", () => {
    const result = scorePrompt(
      "Fix the `validateUser` function in src/auth/login.ts — it should return an error when email is missing"
    );
    expect(result.specificity).toBe(25);
    expect(result.actionability).toBe(25);
    expect(result.doneCondition).toBe(25);
    expect(result.total).toBeGreaterThanOrEqual(75);
    expect(["A+", "A", "A-", "B+"]).toContain(result.grade);
  });

  it("gives low score to a vague prompt", () => {
    const result = scorePrompt("make it better");
    expect(result.specificity).toBe(5);
    expect(result.actionability).toBe(15); // "make" is a vague verb
    expect(result.total).toBeLessThanOrEqual(55);
    expect(result.feedback.length).toBeGreaterThan(0);
  });

  it("detects file paths for specificity", () => {
    const result = scorePrompt("update src/index.ts");
    expect(result.specificity).toBe(25);
  });

  it("detects backtick identifiers for specificity", () => {
    const result = scorePrompt("rename `oldFunction` to `newFunction`");
    expect(result.specificity).toBe(25);
  });

  it("gives partial specificity for generic keywords", () => {
    const result = scorePrompt("update the component");
    expect(result.specificity).toBe(15);
  });

  it("gives full actionability for specific verbs", () => {
    for (const verb of ["add", "remove", "fix", "refactor", "create", "delete", "extract", "implement"]) {
      const result = scorePrompt(`${verb} something`);
      expect(result.actionability).toBe(25);
    }
  });

  it("gives partial actionability for vague verbs", () => {
    const result = scorePrompt("improve the code");
    expect(result.actionability).toBe(15);
  });

  it("gives low actionability for no verb", () => {
    const result = scorePrompt("the login page");
    expect(result.actionability).toBe(5);
  });

  it("detects done conditions", () => {
    const result = scorePrompt("it should return 404");
    expect(result.doneCondition).toBe(25);
  });

  it("gives partial done condition for questions", () => {
    const result = scorePrompt("why is this broken?");
    expect(result.doneCondition).toBe(20);
  });

  it("detects narrow scope keywords", () => {
    const result = scorePrompt("only change the header");
    expect(result.scope).toBe(25);
  });

  it("penalizes broad scope keywords", () => {
    const result = scorePrompt("all files");
    expect(result.scope).toBe(10);
  });

  it("gives A+ for perfect prompt", () => {
    const result = scorePrompt(
      "Fix `handleSubmit` in src/forms/contact.ts — it should only validate the email field and return an error message when invalid"
    );
    expect(result.total).toBe(100);
    expect(result.grade).toBe("A+");
  });

  it("gives F for empty-like prompt", () => {
    const result = scorePrompt("yo");
    expect(result.total).toBeLessThanOrEqual(45);
    expect(result.grade).toBe("F");
  });

  it("returns congratulatory feedback for perfect scores", () => {
    const result = scorePrompt(
      "Fix `handleSubmit` in src/forms/contact.ts — it should only validate the email field and return an error message when invalid"
    );
    expect(result.feedback).toContain("🏆 Excellent prompt! Clear target, scope, action, and done condition.");
  });

  it("total always equals sum of components", () => {
    const prompts = ["hello", "fix src/foo.ts", "refactor `bar` to return null", "do stuff"];
    for (const p of prompts) {
      const r = scorePrompt(p);
      expect(r.total).toBe(r.specificity + r.scope + r.actionability + r.doneCondition);
    }
  });

  it("grade boundaries are correct", () => {
    // We can't easily control exact scores, but we can verify the mapping logic
    // by checking that known prompts land in reasonable grade ranges
    const vague = scorePrompt("stuff");
    expect(["D", "F"]).toContain(vague.grade);

    const decent = scorePrompt("fix the function in src/app.ts");
    expect(["B+", "B", "B-", "A-", "A", "C+"]).toContain(decent.grade);
  });
});
