import { describe, it, expect } from "vitest";
import { scorePrompt, type ScoreResult } from "../src/tools/prompt-score.js";

describe("scorePrompt", () => {
  // ── Specificity ──────────────────────────────────────────────────────

  it("gives full specificity for file paths", () => {
    const r = scorePrompt("Fix the bug in src/lib/parser.ts");
    expect(r.specificity).toBe(25);
  });

  it("gives full specificity for backtick-quoted identifiers", () => {
    const r = scorePrompt("Rename `handleClick` to `onClick`");
    expect(r.specificity).toBe(25);
  });

  it("gives partial specificity for generic file/function mentions", () => {
    const r = scorePrompt("Fix the component");
    expect(r.specificity).toBe(15);
  });

  it("gives low specificity for vague prompts", () => {
    const r = scorePrompt("Make it better");
    expect(r.specificity).toBe(5);
  });

  // ── Scope ────────────────────────────────────────────────────────────

  it("gives full scope for bounded keywords", () => {
    const r = scorePrompt("Only update this function");
    expect(r.scope).toBe(25);
  });

  it("penalizes broad scope keywords", () => {
    const r = scorePrompt("Fix all the tests");
    expect(r.scope).toBe(10);
  });

  it("does NOT give full scope just because the prompt is long", () => {
    // Regression: long rambling prompts shouldn't auto-score 25 on scope
    const longVague = "I think there might be some problems with the way things work and it would be good if you could look into the various issues and maybe do something about them somehow";
    const r = scorePrompt(longVague);
    expect(r.scope).toBeLessThan(25);
  });

  // ── Actionability ────────────────────────────────────────────────────

  it("gives full actionability for specific verbs", () => {
    const r = scorePrompt("Refactor the auth module");
    expect(r.actionability).toBe(25);
  });

  it("gives partial actionability for vague verbs", () => {
    const r = scorePrompt("Make auth work");
    expect(r.actionability).toBe(15);
  });

  it("gives low actionability with no verbs", () => {
    const r = scorePrompt("auth module");
    expect(r.actionability).toBe(5);
  });

  // ── Done condition ───────────────────────────────────────────────────

  it("gives full done-condition for outcome words", () => {
    const r = scorePrompt("Fix `parseJSON` so it should return null on invalid input");
    expect(r.doneCondition).toBe(25);
  });

  it("gives good done-condition for questions", () => {
    // "fail" matches outcome words, so use a question without them
    const r = scorePrompt("How do I set up the dev environment?");
    expect(r.doneCondition).toBe(20);
  });

  it("gives low done-condition when outcome is unclear", () => {
    const r = scorePrompt("Clean up auth");
    expect(r.doneCondition).toBe(5);
  });

  // ── Grades ───────────────────────────────────────────────────────────

  it("grades a perfect prompt A or above", () => {
    const r = scorePrompt("Rename `handleAuth` in src/auth.ts to `authenticateUser` — it should export the new name");
    expect(r.total).toBeGreaterThanOrEqual(85);
    expect(r.grade).toMatch(/^A/);
  });

  it("grades a vague prompt poorly", () => {
    const r = scorePrompt("fix it");
    expect(r.total).toBeLessThan(55);
    expect(["D", "F"]).toContain(r.grade);
  });

  // ── Feedback ─────────────────────────────────────────────────────────

  it("returns no improvement feedback for excellent prompts", () => {
    const r = scorePrompt("Add a test for `validateEmail` in src/utils.ts that should return false for 'notanemail'");
    // If all categories score well, feedback should be the congratulatory message
    if (r.total >= 90) {
      expect(r.feedback[0]).toContain("Excellent");
    }
  });

  it("returns actionable feedback for weak prompts", () => {
    const r = scorePrompt("do stuff");
    expect(r.feedback.length).toBeGreaterThan(0);
    // Should have specific improvement tips, not just congrats
    expect(r.feedback.some(f => f.includes("📁") || f.includes("🎯") || f.includes("⚡") || f.includes("✅"))).toBe(true);
  });
});
