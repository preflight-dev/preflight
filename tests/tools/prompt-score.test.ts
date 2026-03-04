import { describe, it, expect } from "vitest";

// We need to extract scorePrompt for testing. Since it's not exported,
// we'll test the logic by reimporting the module internals.
// For now, let's replicate the scoring logic to verify behavior,
// then refactor the source to export scorePrompt.

// Actually — let's just refactor the source to export scorePrompt first.
// This test file assumes the refactored version.

import { scorePrompt } from "../../src/tools/prompt-score.js";

describe("scorePrompt", () => {
  describe("specificity", () => {
    it("scores 25 for prompts with file paths", () => {
      const result = scorePrompt("Fix the bug in src/tools/prompt-score.ts");
      expect(result.specificity).toBe(25);
    });

    it("scores 25 for prompts with backtick identifiers", () => {
      const result = scorePrompt("Rename `handleClick` to `onSubmit`");
      expect(result.specificity).toBe(25);
    });

    it("scores 15 for generic component mentions", () => {
      const result = scorePrompt("Update the function");
      expect(result.specificity).toBe(15);
    });

    it("scores 5 for completely vague prompts", () => {
      const result = scorePrompt("make it better");
      expect(result.specificity).toBe(5);
    });
  });

  describe("scope", () => {
    it("scores 25 for bounded tasks", () => {
      const result = scorePrompt("Only change this one line");
      expect(result.scope).toBe(25);
    });

    it("scores 10 for overly broad scope", () => {
      const result = scorePrompt("Fix all bugs");
      expect(result.scope).toBe(10);
    });
  });

  describe("actionability", () => {
    it("scores 25 for specific action verbs", () => {
      const result = scorePrompt("Rename the variable to camelCase");
      expect(result.actionability).toBe(25);
    });

    it("scores 15 for vague verbs like 'make'", () => {
      const result = scorePrompt("Make the code work");
      expect(result.actionability).toBe(15);
    });

    it("scores 5 for no verb at all", () => {
      const result = scorePrompt("the button color");
      expect(result.actionability).toBe(5);
    });
  });

  describe("done condition", () => {
    it("scores 25 for prompts with verifiable outcomes", () => {
      const result = scorePrompt("Fix it so the test should pass");
      expect(result.doneCondition).toBe(25);
    });

    it("scores 20 for questions", () => {
      const result = scorePrompt("Why is this breaking?");
      expect(result.doneCondition).toBe(20);
    });

    it("scores 5 for no done condition", () => {
      const result = scorePrompt("Refactor the code");
      expect(result.doneCondition).toBe(5);
    });
  });

  describe("grading", () => {
    it("gives A+ for perfect prompts", () => {
      // File path (25) + bounded (25) + action verb (25) + outcome (25) = 100
      const result = scorePrompt(
        "Fix the bug in `src/server.ts` — only the validation check should return a 400 error"
      );
      expect(result.total).toBe(100);
      expect(result.grade).toBe("A+");
    });

    it("gives F for terrible prompts", () => {
      const result = scorePrompt("stuff");
      expect(result.total).toBeLessThanOrEqual(45);
      expect(result.grade).toBe("F");
    });

    it("includes feedback for low-scoring dimensions", () => {
      const result = scorePrompt("stuff");
      expect(result.feedback.length).toBeGreaterThan(0);
      expect(result.feedback.some((f) => f.includes("📁"))).toBe(true);
    });

    it("gives praise for perfect scores", () => {
      const result = scorePrompt(
        "Fix the bug in `src/server.ts` — only the validation check should return a 400 error"
      );
      expect(result.feedback[0]).toContain("🏆");
    });
  });

  describe("total calculation", () => {
    it("total equals sum of all dimensions", () => {
      const result = scorePrompt("Add a test for the parser module");
      expect(result.total).toBe(
        result.specificity + result.scope + result.actionability + result.doneCondition
      );
    });
  });
});
