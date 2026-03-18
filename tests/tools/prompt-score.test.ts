import { describe, it, expect } from "vitest";
import { scorePrompt } from "../../src/tools/prompt-score.js";

describe("scorePrompt", () => {
  describe("specificity", () => {
    it("gives max specificity for file paths", () => {
      const result = scorePrompt("Fix the bug in src/lib/parser.ts");
      expect(result.specificity).toBe(25);
    });

    it("gives max specificity for backtick identifiers", () => {
      const result = scorePrompt("Rename `handleClick` to `onClick`");
      expect(result.specificity).toBe(25);
    });

    it("gives partial specificity for generic component words", () => {
      const result = scorePrompt("Update the component to handle errors");
      expect(result.specificity).toBe(15);
    });

    it("gives low specificity for vague prompts", () => {
      const result = scorePrompt("Make it better");
      expect(result.specificity).toBe(5);
    });
  });

  describe("scope", () => {
    it("gives max scope for bounded tasks with 'only'", () => {
      const result = scorePrompt("Only change the header color");
      expect(result.scope).toBe(25);
    });

    it("gives max scope for long prompts (>100 chars)", () => {
      const prompt = "a".repeat(101);
      const result = scorePrompt(prompt);
      expect(result.scope).toBe(25);
    });

    it("penalizes broad scope with 'all/every'", () => {
      const result = scorePrompt("Fix all bugs");
      expect(result.scope).toBe(10);
    });
  });

  describe("actionability", () => {
    it("gives max for specific action verbs", () => {
      const result = scorePrompt("Refactor the auth module");
      expect(result.actionability).toBe(25);
    });

    it("gives partial for vague verbs like 'make'", () => {
      const result = scorePrompt("Make the tests work");
      expect(result.actionability).toBe(15);
    });

    it("gives low for no action verb", () => {
      const result = scorePrompt("The button is blue");
      expect(result.actionability).toBe(5);
    });
  });

  describe("done condition", () => {
    it("gives max for prompts with verifiable outcomes", () => {
      const result = scorePrompt("Fix it so it should return null on error");
      expect(result.doneCondition).toBe(25);
    });

    it("gives good score for questions", () => {
      const result = scorePrompt("Why does this crash?");
      expect(result.doneCondition).toBe(20);
    });

    it("gives low for no done condition", () => {
      const result = scorePrompt("Clean up the code");
      expect(result.doneCondition).toBe(5);
    });
  });

  describe("grading", () => {
    it("gives A+ for perfect prompts", () => {
      // Hits all 4 dimensions: backtick (25), 'only' (25), 'rename' (25), 'should' (25)
      const result = scorePrompt("Only rename `foo` to `bar` — it should compile");
      expect(result.total).toBe(100);
      expect(result.grade).toBe("A+");
    });

    it("gives F for completely vague prompts", () => {
      const result = scorePrompt("Do it");
      expect(result.total).toBeLessThanOrEqual(45);
      expect(result.grade).toBe("F");
    });

    it("includes feedback for imperfect prompts", () => {
      const result = scorePrompt("Make it better");
      expect(result.feedback.length).toBeGreaterThan(0);
      expect(result.feedback.some((f) => f.includes("📁"))).toBe(true);
    });

    it("gives congratulatory feedback for perfect scores", () => {
      const result = scorePrompt("Only rename `foo` to `bar` — it should compile");
      expect(result.feedback[0]).toContain("🏆");
    });
  });

  describe("total is sum of dimensions", () => {
    it("total equals sum of all four scores", () => {
      const result = scorePrompt("Add a test for the login function");
      expect(result.total).toBe(
        result.specificity + result.scope + result.actionability + result.doneCondition,
      );
    });
  });
});
