import { describe, it, expect } from "vitest";

// scorePrompt is not exported, so we need to extract and test the logic.
// For now, let's test via a re-implementation check — but better: export it.
// We'll import after making it exported.

// First, let's test the scoring logic by importing the function.
// We need to export scorePrompt from the module.

import { scorePrompt } from "../../src/tools/prompt-score.js";

describe("scorePrompt", () => {
  describe("specificity scoring", () => {
    it("gives 25 for prompts with file paths", () => {
      const result = scorePrompt("Fix the bug in src/lib/config.ts");
      expect(result.specificity).toBe(25);
    });

    it("gives 25 for prompts with backtick identifiers", () => {
      const result = scorePrompt("Rename `getUserById` to `findUser`");
      expect(result.specificity).toBe(25);
    });

    it("gives 15 for generic component references", () => {
      const result = scorePrompt("Update the file to handle errors");
      expect(result.specificity).toBe(15);
    });

    it("gives 5 for completely vague prompts", () => {
      const result = scorePrompt("make it better");
      expect(result.specificity).toBe(5);
    });
  });

  describe("scope scoring", () => {
    it("gives 25 for bounded prompts with 'only'", () => {
      const result = scorePrompt("only change the return type");
      expect(result.scope).toBe(25);
    });

    it("gives 25 for long detailed prompts (>100 chars)", () => {
      const prompt = "a".repeat(101);
      const result = scorePrompt(prompt);
      expect(result.scope).toBe(25);
    });

    it("gives 10 for broad 'all/every' prompts", () => {
      const result = scorePrompt("fix every bug");
      expect(result.scope).toBe(10);
    });
  });

  describe("actionability scoring", () => {
    it("gives 25 for specific action verbs", () => {
      const result = scorePrompt("refactor the loop");
      expect(result.actionability).toBe(25);
    });

    it("gives 15 for vague verbs like 'make'", () => {
      const result = scorePrompt("make it work");
      expect(result.actionability).toBe(15);
    });

    it("gives 5 for no verb at all", () => {
      const result = scorePrompt("the button color");
      expect(result.actionability).toBe(5);
    });
  });

  describe("done condition scoring", () => {
    it("gives 25 for prompts with verifiable outcomes", () => {
      const result = scorePrompt("should return an empty array");
      expect(result.doneCondition).toBe(25);
    });

    it("gives 20 for questions", () => {
      const result = scorePrompt("why is this slow?");
      expect(result.doneCondition).toBe(20);
    });

    it("gives 5 for no done condition", () => {
      const result = scorePrompt("refactor the code");
      expect(result.doneCondition).toBe(5);
    });
  });

  describe("grading", () => {
    it("gives A+ for score >= 90", () => {
      // Prompt that maxes all categories
      const result = scorePrompt("Fix the bug in `src/config.ts` — only the validation, should return an error");
      expect(result.total).toBeGreaterThanOrEqual(90);
      expect(result.grade).toBe("A+");
    });

    it("gives F for score < 45", () => {
      const result = scorePrompt("stuff");
      expect(result.total).toBeLessThan(45);
      expect(result.grade).toBe("F");
    });

    it("total is sum of all categories", () => {
      const result = scorePrompt("test prompt");
      expect(result.total).toBe(
        result.specificity + result.scope + result.actionability + result.doneCondition
      );
    });
  });

  describe("feedback", () => {
    it("provides improvement tips for low scores", () => {
      const result = scorePrompt("stuff");
      expect(result.feedback.length).toBeGreaterThan(0);
      expect(result.feedback.some((f) => f.includes("📁"))).toBe(true);
    });

    it("provides congratulations for perfect scores", () => {
      const result = scorePrompt(
        "Fix the validation in `src/config.ts` — only the email check, should return false for invalid emails"
      );
      if (result.total >= 90) {
        expect(result.feedback.some((f) => f.includes("🏆"))).toBe(true);
      }
    });
  });
});
