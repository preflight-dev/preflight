import { describe, it, expect } from "vitest";
import { scorePrompt } from "../src/tools/prompt-score.js";

describe("scorePrompt", () => {
  it("gives high specificity for prompts with file paths", () => {
    const result = scorePrompt("Fix the bug in src/lib/config.ts where getConfig returns undefined");
    expect(result.specificity).toBe(25);
  });

  it("gives high specificity for prompts with backtick identifiers", () => {
    const result = scorePrompt("Rename `handleClick` to `onSubmit`");
    expect(result.specificity).toBe(25);
  });

  it("gives medium specificity for generic component mentions", () => {
    const result = scorePrompt("Update the component to use the new API");
    expect(result.specificity).toBe(15);
  });

  it("gives low specificity for vague prompts", () => {
    const result = scorePrompt("Make it better");
    expect(result.specificity).toBe(5);
  });

  it("gives high scope for bounded prompts", () => {
    const result = scorePrompt("Only update the error message in the login form validation");
    expect(result.scope).toBe(25);
  });

  it("penalizes unbounded scope with 'all/every'", () => {
    const result = scorePrompt("Fix all bugs");
    expect(result.scope).toBe(10);
    expect(result.feedback.some(f => f.includes("broad"))).toBe(true);
  });

  it("gives high actionability for specific verbs", () => {
    const result = scorePrompt("Refactor the auth middleware to use async/await");
    expect(result.actionability).toBe(25);
  });

  it("gives medium actionability for vague verbs", () => {
    const result = scorePrompt("Make the login work properly");
    expect(result.actionability).toBe(15);
  });

  it("gives low actionability for prompts with no action verb", () => {
    const result = scorePrompt("The login page");
    expect(result.actionability).toBe(5);
  });

  it("gives high done-condition score for verifiable outcomes", () => {
    const result = scorePrompt("Fix the auth middleware so it should return 401 for expired tokens");
    expect(result.doneCondition).toBe(25);
  });

  it("gives decent done-condition score for questions", () => {
    const result = scorePrompt("Why is the login page slow?");
    expect(result.doneCondition).toBe(20);
  });

  it("gives low done-condition for prompts without outcomes", () => {
    const result = scorePrompt("Refactor the auth code");
    expect(result.doneCondition).toBe(5);
  });

  it("total is sum of all dimensions", () => {
    const result = scorePrompt("Fix `parseConfig` in src/lib/config.ts so it should return a default when the file is missing");
    expect(result.total).toBe(result.specificity + result.scope + result.actionability + result.doneCondition);
  });

  it("assigns A+ grade for score >= 90", () => {
    // High specificity (file path) + high scope (>100 chars) + high action (fix) + high done (should)
    const result = scorePrompt("Fix the validation bug in src/components/LoginForm.tsx so the email field should display a red border and error message when an invalid email is submitted");
    expect(result.total).toBeGreaterThanOrEqual(90);
    expect(result.grade).toBe("A+");
  });

  it("assigns F grade for very vague prompts", () => {
    const result = scorePrompt("stuff");
    expect(result.total).toBeLessThan(45);
    expect(result.grade).toBe("F");
  });

  it("provides congratulatory feedback for perfect scores", () => {
    const result = scorePrompt("Fix the validation bug in src/components/LoginForm.tsx so the email field should display a red border and error message when an invalid email is submitted");
    if (result.total >= 90) {
      expect(result.feedback.some(f => f.includes("Excellent"))).toBe(true);
    }
  });

  it("provides improvement tips for low scores", () => {
    const result = scorePrompt("stuff");
    expect(result.feedback.length).toBeGreaterThan(0);
    expect(result.feedback.some(f => f.includes("No specific targets"))).toBe(true);
  });
});
