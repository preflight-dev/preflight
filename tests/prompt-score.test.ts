import { describe, it, expect } from "vitest";

// We need to extract scorePrompt for testing. For now, we'll re-implement the
// import path. The function is not currently exported, so we'll test via a
// local copy and then export it properly.

// After we export scorePrompt from the module, update this import:
import { scorePrompt } from "../src/lib/prompt-scoring.js";

describe("scorePrompt", () => {
  describe("specificity", () => {
    it("gives 25 for file paths", () => {
      const r = scorePrompt("Fix the bug in src/utils/parser.ts");
      expect(r.specificity).toBe(25);
    });

    it("gives 25 for backtick identifiers", () => {
      const r = scorePrompt("Rename `handleClick` to `onClick`");
      expect(r.specificity).toBe(25);
    });

    it("gives 15 for generic file/function mentions", () => {
      const r = scorePrompt("Update the component");
      expect(r.specificity).toBe(15);
    });

    it("gives 5 for no specifics", () => {
      const r = scorePrompt("Make it better");
      expect(r.specificity).toBe(5);
    });
  });

  describe("scope", () => {
    it("gives 25 for bounded scope keywords", () => {
      const r = scorePrompt("Only update `parseArgs` in src/cli.ts to return errors");
      expect(r.scope).toBe(25);
    });

    it("gives 10 for broad scope like 'all'", () => {
      const r = scorePrompt("Fix all bugs");
      expect(r.scope).toBe(10);
    });

    it("gives 10 for unclear scope on short prompts", () => {
      const r = scorePrompt("Fix it");
      expect(r.scope).toBe(10);
    });
  });

  describe("actionability", () => {
    it("gives 25 for specific action verbs", () => {
      const r = scorePrompt("Refactor the auth module");
      expect(r.actionability).toBe(25);
    });

    it("gives 15 for vague verbs like 'make'", () => {
      const r = scorePrompt("Make the tests work");
      expect(r.actionability).toBe(15);
    });

    it("gives 5 for no action verb", () => {
      const r = scorePrompt("The button is broken");
      expect(r.actionability).toBe(5);
    });
  });

  describe("done condition", () => {
    it("gives 25 for outcome keywords", () => {
      const r = scorePrompt("Fix `parseArgs` so it should return an error object");
      expect(r.doneCondition).toBe(25);
    });

    it("gives 20 for questions", () => {
      const r = scorePrompt("Why does the parser crash on empty input?");
      expect(r.doneCondition).toBe(20);
    });

    it("gives 5 for no done condition", () => {
      const r = scorePrompt("Refactor the auth module");
      expect(r.doneCondition).toBe(5);
    });
  });

  describe("grading", () => {
    it("gives A+ for perfect prompts", () => {
      const r = scorePrompt(
        "Rename `handleSubmit` in src/forms/login.ts to `onSubmitLogin` — the test in login.test.ts should still pass"
      );
      expect(r.total).toBeGreaterThanOrEqual(90);
      expect(r.grade).toBe("A+");
    });

    it("gives D or lower for weak prompts", () => {
      const r = scorePrompt("Fix it");
      // "Fix" is a good verb (25) but everything else is weak
      expect(r.total).toBeLessThanOrEqual(45);
      expect(["D", "F"]).toContain(r.grade);
    });

    it("total equals sum of dimensions", () => {
      const r = scorePrompt("Add error handling to `fetchData` in src/api.ts so it should return null on 404");
      expect(r.total).toBe(r.specificity + r.scope + r.actionability + r.doneCondition);
    });
  });

  describe("feedback", () => {
    it("gives praise for excellent prompts", () => {
      const r = scorePrompt(
        "Only rename `handleSubmit` in src/forms/login.ts to `onSubmitLogin` — test should pass"
      );
      expect(r.feedback.some((f) => f.includes("Excellent"))).toBe(true);
    });

    it("gives actionable feedback for weak prompts", () => {
      const r = scorePrompt("Fix it");
      expect(r.feedback.length).toBeGreaterThan(0);
      expect(r.feedback.some((f) => f.includes("Excellent"))).toBe(false);
    });
  });

  describe("edge cases", () => {
    it("handles empty string", () => {
      const r = scorePrompt("");
      expect(r.total).toBeGreaterThanOrEqual(0);
      expect(r.grade).toBeTruthy();
    });

    it("handles very long prompts", () => {
      const long = "Add the following fields to the user model: ".padEnd(200, "x");
      const r = scorePrompt(long);
      expect(r.total).toBeGreaterThan(0);
    });
  });
});
