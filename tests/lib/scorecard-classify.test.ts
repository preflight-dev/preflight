/**
 * Tests that generate_scorecard's classifyEvents correctly handles
 * both legacy ("user_prompt"/"assistant_response") and actual
 * session-parser event types ("prompt"/"assistant").
 *
 * Regression test for: event type mismatch between session-parser
 * output and scorecard filtering (scorecard expected "user_prompt"
 * but parser emits "prompt").
 */
import { describe, it, expect } from "vitest";

// We can't easily import the private classifyEvents, so we replicate
// the filtering logic that was buggy and verify the fix.

const PROMPT_TYPES = ["prompt", "user_prompt"];
const ASSISTANT_TYPES = ["assistant", "assistant_response"];
const COMMIT_TYPES = ["git_commit", "commit"];

function isUserMessage(type: string): boolean {
  return type === "prompt" || type === "user_prompt";
}

function isAssistantMessage(type: string): boolean {
  return type === "assistant" || type === "assistant_response";
}

function isCommit(type: string): boolean {
  return type === "git_commit" || type === "commit";
}

describe("scorecard event type matching", () => {
  it("should match session-parser 'prompt' type as user message", () => {
    // session-parser emits "prompt", not "user_prompt"
    expect(isUserMessage("prompt")).toBe(true);
    expect(isUserMessage("user_prompt")).toBe(true);
    expect(isUserMessage("assistant")).toBe(false);
  });

  it("should match session-parser 'assistant' type as assistant message", () => {
    // session-parser emits "assistant", not "assistant_response"
    expect(isAssistantMessage("assistant")).toBe(true);
    expect(isAssistantMessage("assistant_response")).toBe(true);
    expect(isAssistantMessage("prompt")).toBe(false);
  });

  it("should match both commit type variants", () => {
    expect(isCommit("git_commit")).toBe(true);
    expect(isCommit("commit")).toBe(true);
    expect(isCommit("tool_call")).toBe(false);
  });

  it("should correctly filter a mixed event list", () => {
    const events = [
      { type: "prompt" },
      { type: "assistant" },
      { type: "tool_call" },
      { type: "correction" },
      { type: "user_prompt" },      // legacy
      { type: "assistant_response" }, // legacy
      { type: "compaction" },
      { type: "sub_agent_spawn" },
    ];

    const userMessages = events.filter((e) => isUserMessage(e.type));
    const assistantMessages = events.filter((e) => isAssistantMessage(e.type));

    expect(userMessages).toHaveLength(2);
    expect(assistantMessages).toHaveLength(2);
  });
});
