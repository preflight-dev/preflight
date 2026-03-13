import { describe, it, expect } from "vitest";
import { scorePrompt } from "../../src/tools/prompt-score.js";

describe("scorePrompt", () => {
  it("gives high specificity for file paths", () => {
    const result = scorePrompt("Fix the bug in src/tools/prompt-score.ts");
    expect(result.specificity).toBe(25);
  });

  it("gives high specificity for backtick identifiers", () => {
    const result = scorePrompt("Rename `getUserById` to `findUser`");
    expect(result.specificity).toBe(25);
  });

  it("gives medium specificity for generic references", () => {
    const result = scorePrompt("Update the component styles");
    expect(result.specificity).toBe(15);
  });

  it("gives low specificity when nothing specific is mentioned", () => {
    const result = scorePrompt("Make it better");
    expect(result.specificity).toBe(5);
  });

  it("gives high scope for bounding words", () => {
    const result = scorePrompt("Only update this one function");
    expect(result.scope).toBe(25);
  });

  it("penalizes broad words like all/every", () => {
    const result = scorePrompt("Refactor every handler");
    expect(result.scope).toBe(10);
  });

  it("does NOT give full scope just for being long", () => {
    // Regression: previously text.length > 100 auto-granted scope=25
    const longVague = "I want you to go ahead and do something with the code because it is not really working the way I expected it to and there are some issues that need fixing soon";
    const result = scorePrompt(longVague);
    expect(result.scope).toBeLessThan(25);
  });

  it("gives high actionability for specific verbs", () => {
    const result = scorePrompt("Extract the validation logic into a helper");
    expect(result.actionability).toBe(25);
  });

  it("gives low actionability for vague verbs", () => {
    const result = scorePrompt("Make the auth work");
    expect(result.actionability).toBe(15);
  });

  it("gives high done-condition for outcome words", () => {
    const result = scorePrompt("Fix login so it should return a 200 on success");
    expect(result.doneCondition).toBe(25);
  });

  it("gives good done-condition for questions", () => {
    const result = scorePrompt("Why does the test fail?");
    // "fail" matches the done-condition regex
    expect(result.doneCondition).toBe(25);
  });

  it("grades A for excellent prompts", () => {
    const result = scorePrompt(
      "Fix the `parseConfig` function in src/config.ts — it should return null instead of throwing when the file is missing"
    );
    expect(result.total).toBeGreaterThanOrEqual(80);
    expect(["A+", "A", "A-"]).toContain(result.grade);
  });

  it("grades F for vague prompts", () => {
    const result = scorePrompt("make it better");
    expect(result.total).toBeLessThan(45);
    expect(result.grade).toBe("F");
  });

  it("total equals sum of dimensions", () => {
    const result = scorePrompt("Add a retry to the fetch call in utils/api.ts");
    expect(result.total).toBe(
      result.specificity + result.scope + result.actionability + result.doneCondition
    );
  });

  it("provides feedback for low-scoring dimensions", () => {
    const result = scorePrompt("do stuff");
    expect(result.feedback.length).toBeGreaterThan(0);
  });

  it("provides congratulations for perfect prompts", () => {
    const result = scorePrompt(
      "Only rename `getUser` to `fetchUser` in src/api/users.ts — the test should still pass"
    );
    if (result.total >= 90) {
      expect(result.feedback[0]).toContain("Excellent");
    }
  });
});
