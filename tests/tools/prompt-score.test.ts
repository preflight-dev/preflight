import { describe, it, expect } from "vitest";
import { scorePrompt } from "../../src/tools/prompt-score.js";

describe("scorePrompt", () => {
  describe("specificity scoring", () => {
    it("scores 25 for file paths", () => {
      const result = scorePrompt("Fix the bug in src/utils.ts");
      expect(result.specificity).toBe(25);
    });

    it("scores 25 for backtick-quoted identifiers", () => {
      const result = scorePrompt("Rename `handleClick` to `onClick`");
      expect(result.specificity).toBe(25);
    });

    it("scores 15 for generic target words like 'function'", () => {
      const result = scorePrompt("Fix the function");
      expect(result.specificity).toBe(15);
    });

    it("scores 5 for no specific targets", () => {
      const result = scorePrompt("Make it better");
      expect(result.specificity).toBe(5);
    });
  });

  describe("scope scoring", () => {
    it("scores 25 for bounded scope words", () => {
      const result = scorePrompt("Only update the header");
      expect(result.scope).toBe(25);
    });

    it("scores 25 for long prompts (>100 chars)", () => {
      const longPrompt = "a".repeat(101);
      const result = scorePrompt(longPrompt);
      expect(result.scope).toBe(25);
    });

    it("scores 10 for broad scope words", () => {
      const result = scorePrompt("Fix every bug");
      expect(result.scope).toBe(10);
    });

    it("scores 10 for unclear scope", () => {
      const result = scorePrompt("Fix bugs");
      expect(result.scope).toBe(10);
    });
  });

  describe("actionability scoring", () => {
    it("scores 25 for specific action verbs", () => {
      const verbs = ["add", "remove", "rename", "refactor", "fix", "create", "delete", "update", "extract", "implement", "migrate"];
      for (const verb of verbs) {
        const result = scorePrompt(`${verb} the thing`);
        expect(result.actionability).toBe(25);
      }
    });

    it("scores 15 for vague verbs", () => {
      const result = scorePrompt("Make it work");
      expect(result.actionability).toBe(15);
    });

    it("scores 5 for no action verb", () => {
      const result = scorePrompt("the button is broken");
      expect(result.actionability).toBe(5);
    });
  });

  describe("done condition scoring", () => {
    it("scores 25 for verifiable outcome words", () => {
      const result = scorePrompt("Fix it so it should return 42");
      expect(result.doneCondition).toBe(25);
    });

    it("scores 20 for questions", () => {
      const result = scorePrompt("Why is this slow?");
      expect(result.doneCondition).toBe(20);
    });

    it("scores 5 for no done condition", () => {
      const result = scorePrompt("Fix the bug");
      expect(result.doneCondition).toBe(5);
    });
  });

  describe("grading", () => {
    it("gives A+ for perfect prompts (>=90)", () => {
      // specificity=25 (file path) + scope=25 (just) + actionability=25 (fix) + doneCondition=25 (should)
      const result = scorePrompt("Just fix src/index.ts so it should compile");
      expect(result.total).toBeGreaterThanOrEqual(90);
      expect(result.grade).toBe("A+");
    });

    it("gives F for the worst prompts (<45)", () => {
      const result = scorePrompt("help");
      expect(result.total).toBeLessThan(45);
      expect(result.grade).toBe("F");
    });

    it("returns encouraging feedback when all criteria are met", () => {
      const result = scorePrompt("Just fix src/index.ts so it should compile");
      expect(result.feedback).toContain("🏆 Excellent prompt! Clear target, scope, action, and done condition.");
    });

    it("returns improvement tips when criteria are missed", () => {
      const result = scorePrompt("help");
      expect(result.feedback.length).toBeGreaterThan(0);
      expect(result.feedback.some(f => f.includes("📁"))).toBe(true);
    });
  });

  describe("edge cases", () => {
    it("handles empty string", () => {
      const result = scorePrompt("");
      expect(result.total).toBe(25); // 5+10+5+5
      expect(result.grade).toBe("F");
    });

    it("handles very long prompts", () => {
      const result = scorePrompt("Fix the bug in " + "a".repeat(200));
      expect(result.scope).toBe(25); // length > 100
    });

    it("is case-insensitive for keywords", () => {
      const result = scorePrompt("JUST FIX the FUNCTION so it SHOULD work");
      expect(result.specificity).toBe(15); // "function"
      expect(result.scope).toBe(25); // "just"
      expect(result.actionability).toBe(25); // "fix"
      expect(result.doneCondition).toBe(25); // "should"
    });
  });
});
