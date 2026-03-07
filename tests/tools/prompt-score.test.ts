import { describe, it, expect } from "vitest";
import { scorePrompt } from "../../src/tools/prompt-score.js";

describe("scorePrompt", () => {
  describe("specificity", () => {
    it("gives 25 for file paths", () => {
      const result = scorePrompt("Fix the bug in src/tools/prompt-score.ts");
      expect(result.specificity).toBe(25);
    });

    it("gives 25 for backtick-quoted identifiers", () => {
      const result = scorePrompt("Rename `handleClick` to `onClick`");
      expect(result.specificity).toBe(25);
    });

    it("gives 15 for generic structural words", () => {
      const result = scorePrompt("Update the component to use hooks");
      expect(result.specificity).toBe(15);
    });

    it("gives 5 for no specific targets", () => {
      const result = scorePrompt("Make it better");
      expect(result.specificity).toBe(5);
    });
  });

  describe("scope", () => {
    it("gives 25 for bounding words like 'only' or 'just'", () => {
      const result = scorePrompt("Only update the header component");
      expect(result.scope).toBe(25);
    });

    it("gives 10 for broad words like 'all' or 'every'", () => {
      const result = scorePrompt("Fix all the bugs in every file");
      expect(result.scope).toBe(10);
    });

    it("does NOT give 25 just because prompt is long", () => {
      // This was the bug: text.length > 100 used to give full scope score
      const vague = "I want you to go ahead and do the thing that needs doing because it is important and we should get it done soon please thank you very much";
      const result = scorePrompt(vague);
      expect(vague.length).toBeGreaterThan(100);
      expect(result.scope).toBeLessThan(25);
    });

    it("gives 20 for very long prompts (>200 chars) without explicit scope words", () => {
      const detailed = "a".repeat(201);
      const result = scorePrompt(detailed);
      expect(result.scope).toBe(20);
    });

    it("gives 20 when both bounding and broad words present", () => {
      const result = scorePrompt("Only fix all the errors in this file");
      expect(result.scope).toBe(20);
    });

    it("gives 10 for short vague prompts", () => {
      const result = scorePrompt("Do the thing");
      expect(result.scope).toBe(10);
    });
  });

  describe("actionability", () => {
    it("gives 25 for specific action verbs", () => {
      const result = scorePrompt("Refactor the auth module");
      expect(result.actionability).toBe(25);
    });

    it("gives 15 for vague verbs like 'make' or 'improve'", () => {
      const result = scorePrompt("Improve the performance");
      expect(result.actionability).toBe(15);
    });

    it("gives 5 for no action verb", () => {
      const result = scorePrompt("The button is red");
      expect(result.actionability).toBe(5);
    });
  });

  describe("done condition", () => {
    it("gives 25 for outcome words like 'should' or 'return'", () => {
      const result = scorePrompt("It should return an array of strings");
      expect(result.doneCondition).toBe(25);
    });

    it("gives 20 for questions without outcome words", () => {
      const result = scorePrompt("Why is the sky blue?");
      expect(result.doneCondition).toBe(20);
    });

    it("gives 5 for no verifiable outcome", () => {
      const result = scorePrompt("Refactor the code");
      expect(result.doneCondition).toBe(5);
    });
  });

  describe("grading", () => {
    it("returns A+ for score >= 90", () => {
      // specificity 25 (file path) + scope 25 (bounding) + actionability 25 (verb) + done 25 (outcome)
      const result = scorePrompt("Only fix the bug in `src/index.ts` — should return null");
      expect(result.total).toBeGreaterThanOrEqual(90);
      expect(result.grade).toBe("A+");
    });

    it("returns F for very low scores", () => {
      const result = scorePrompt("hi");
      expect(result.total).toBeLessThan(45);
      expect(result.grade).toBe("F");
    });

    it("total equals sum of components", () => {
      const result = scorePrompt("Add a test for the login function");
      expect(result.total).toBe(
        result.specificity + result.scope + result.actionability + result.doneCondition
      );
    });
  });

  describe("feedback", () => {
    it("gives congratulatory feedback for perfect scores", () => {
      const result = scorePrompt("Only rename `foo` in src/bar.ts — should pass lint");
      if (result.total >= 90) {
        expect(result.feedback[0]).toContain("🏆");
      }
    });

    it("provides actionable suggestions for low scores", () => {
      const result = scorePrompt("Do stuff");
      expect(result.feedback.length).toBeGreaterThan(0);
      expect(result.feedback.some((f) => f.includes("📁") || f.includes("🎯") || f.includes("⚡") || f.includes("✅"))).toBe(true);
    });
  });
});
