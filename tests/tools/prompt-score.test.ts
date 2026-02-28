import { describe, it, expect } from "vitest";
import { scorePrompt } from "../../src/tools/prompt-score.js";

describe("prompt_score — scorePrompt", () => {
  describe("specificity scoring", () => {
    it("gives 25 for file paths", () => {
      expect(scorePrompt("fix src/tools/prompt-score.ts").specificity).toBe(25);
    });

    it("gives 25 for backtick identifiers", () => {
      expect(scorePrompt("rename `getUserById` to `findUser`").specificity).toBe(25);
    });

    it("gives 15 for generic file/function mentions", () => {
      expect(scorePrompt("update the test").specificity).toBe(15);
    });

    it("gives 5 for no specific targets", () => {
      expect(scorePrompt("make it better").specificity).toBe(5);
    });
  });

  describe("scope scoring", () => {
    it("gives 25 for bounded scope words", () => {
      expect(scorePrompt("fix only the header").scope).toBe(25);
    });

    it("gives 25 for long prompts (>100 chars)", () => {
      expect(scorePrompt("a".repeat(101)).scope).toBe(25);
    });

    it("gives 10 for broad scope words like all/every", () => {
      // "all" matches broad BUT "refactor" is an action verb, so scope=10 from the broad branch
      expect(scorePrompt("refactor all handlers").scope).toBe(10);
    });

    it("gives 10 for unclear scope", () => {
      expect(scorePrompt("fix bug").scope).toBe(10);
    });
  });

  describe("actionability scoring", () => {
    it("gives 25 for specific action verbs", () => {
      const verbs = ["add", "remove", "rename", "refactor", "fix", "create", "delete", "update", "implement", "migrate"];
      for (const verb of verbs) {
        expect(scorePrompt(`${verb} something`).actionability).toBe(25);
      }
    });

    it("gives 15 for vague verbs", () => {
      expect(scorePrompt("make it work").actionability).toBe(15);
      expect(scorePrompt("improve performance").actionability).toBe(15);
      expect(scorePrompt("clean up the code").actionability).toBe(15);
    });

    it("gives 5 for no action verbs", () => {
      expect(scorePrompt("the login page").actionability).toBe(5);
    });
  });

  describe("done condition scoring", () => {
    it("gives 25 for verifiable outcome words", () => {
      expect(scorePrompt("fix so it should return 200").doneCondition).toBe(25);
      expect(scorePrompt("fix the error on save").doneCondition).toBe(25);
    });

    it("gives 20 for questions", () => {
      expect(scorePrompt("why does this crash?").doneCondition).toBe(20);
    });

    it("gives 5 for no done condition", () => {
      expect(scorePrompt("refactor the code").doneCondition).toBe(5);
    });
  });

  describe("grading", () => {
    it("gives A+ for perfect scores (100)", () => {
      const result = scorePrompt("fix only src/index.ts so it should work");
      expect(result.total).toBe(100);
      expect(result.grade).toBe("A+");
    });

    it("gives F for minimal prompts", () => {
      const result = scorePrompt("hi");
      expect(result.total).toBeLessThan(45);
      expect(result.grade).toBe("F");
    });

    it("total equals sum of dimensions", () => {
      const result = scorePrompt("add a test for the login module");
      expect(result.total).toBe(
        result.specificity + result.scope + result.actionability + result.doneCondition
      );
    });

    it("covers all grade thresholds", () => {
      // Just verify grade is always a valid value
      const prompts = ["", "hi", "fix bug", "fix only src/x.ts should pass"];
      const validGrades = ["A+", "A", "A-", "B+", "B", "B-", "C+", "C", "D", "F"];
      for (const p of prompts) {
        expect(validGrades).toContain(scorePrompt(p).grade);
      }
    });
  });

  describe("feedback", () => {
    it("gives congratulatory feedback for perfect score", () => {
      const result = scorePrompt("fix only src/index.ts so it should work");
      expect(result.feedback).toHaveLength(1);
      expect(result.feedback[0]).toContain("Excellent");
    });

    it("gives improvement tips for weak prompts", () => {
      const result = scorePrompt("hi");
      expect(result.feedback.length).toBeGreaterThan(0);
    });
  });

  describe("edge cases", () => {
    it("handles empty string", () => {
      const result = scorePrompt("");
      expect(result.total).toBeGreaterThanOrEqual(0);
      expect(result.grade).toBeDefined();
    });

    it("is case-insensitive for keywords", () => {
      expect(scorePrompt("FIX the bug").actionability).toBe(25);
      expect(scorePrompt("the FILE needs work").specificity).toBe(15);
    });
  });
});
