import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { writeFileSync, mkdirSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { analyzeSessionFile } from "../../src/tools/estimate-cost.js";

const TMP = join(tmpdir(), "preflight-estimate-cost-test");

function jsonl(...lines: object[]): string {
  return lines.map((l) => JSON.stringify(l)).join("\n");
}

beforeEach(() => mkdirSync(TMP, { recursive: true }));
afterEach(() => rmSync(TMP, { recursive: true, force: true }));

describe("analyzeSessionFile", () => {
  it("counts basic user/assistant tokens", () => {
    const file = join(TMP, "session.jsonl");
    writeFileSync(
      file,
      jsonl(
        { type: "user", message: { content: "Hello world" }, timestamp: "2025-01-01T00:00:00Z" },
        { type: "assistant", message: { content: "Hi there, how can I help?" }, timestamp: "2025-01-01T00:01:00Z" },
      ),
    );

    const result = analyzeSessionFile(file);
    expect(result.promptCount).toBe(1);
    expect(result.inputTokens).toBeGreaterThan(0);
    expect(result.outputTokens).toBeGreaterThan(0);
    expect(result.corrections).toBe(0);
    expect(result.firstTimestamp).toBe("2025-01-01T00:00:00Z");
    expect(result.lastTimestamp).toBe("2025-01-01T00:01:00Z");
  });

  it("detects corrections after assistant responses", () => {
    const file = join(TMP, "session.jsonl");
    writeFileSync(
      file,
      jsonl(
        { type: "user", message: { content: "Write a function" }, timestamp: "2025-01-01T00:00:00Z" },
        { type: "assistant", message: { content: "Here is a function that does X..." }, timestamp: "2025-01-01T00:01:00Z" },
        { type: "user", message: { content: "No, that's not what I meant. Try again." }, timestamp: "2025-01-01T00:02:00Z" },
      ),
    );

    const result = analyzeSessionFile(file);
    expect(result.corrections).toBe(1);
    expect(result.wastedOutputTokens).toBeGreaterThan(0);
  });

  it("counts tool calls in assistant content blocks", () => {
    const file = join(TMP, "session.jsonl");
    writeFileSync(
      file,
      jsonl(
        {
          type: "assistant",
          message: {
            content: [
              { type: "text", text: "Let me check that." },
              { type: "tool_use", name: "Read", id: "t1", input: { path: "foo.ts" } },
              { type: "tool_use", name: "clarify_intent", id: "t2", input: { prompt: "test" } },
            ],
          },
          timestamp: "2025-01-01T00:00:00Z",
        },
      ),
    );

    const result = analyzeSessionFile(file);
    expect(result.toolCallCount).toBe(2);
    expect(result.preflightCalls).toBe(1); // clarify_intent is a preflight tool
    expect(result.preflightTokens).toBeGreaterThan(0);
  });

  it("handles content block arrays for extractText (ignores non-text blocks)", () => {
    const file = join(TMP, "session.jsonl");
    writeFileSync(
      file,
      jsonl(
        {
          type: "user",
          message: {
            content: [
              { type: "text", text: "Hello" },
              { type: "tool_use", name: "Read", id: "x", input: { path: "very/long/path/that/should/not/count/as/text/tokens" } },
            ],
          },
          timestamp: "2025-01-01T00:00:00Z",
        },
      ),
    );

    const result = analyzeSessionFile(file);
    // Should only count "Hello" (5 chars → ~2 tokens), not the tool_use block
    expect(result.inputTokens).toBeLessThan(10);
  });

  it("counts tool_result tokens as input", () => {
    const file = join(TMP, "session.jsonl");
    writeFileSync(
      file,
      jsonl(
        {
          type: "tool_result",
          content: "File contents here with some data",
          tool_use_id: "t1",
          timestamp: "2025-01-01T00:00:00Z",
        },
      ),
    );

    const result = analyzeSessionFile(file);
    expect(result.inputTokens).toBeGreaterThan(0);
  });

  it("handles empty/malformed lines gracefully", () => {
    const file = join(TMP, "session.jsonl");
    writeFileSync(file, "not json\n\n{}\n" + JSON.stringify({ type: "user", message: { content: "hi" }, timestamp: "2025-01-01T00:00:00Z" }) + "\n");

    const result = analyzeSessionFile(file);
    expect(result.promptCount).toBe(1);
  });

  it("handles numeric epoch timestamps", () => {
    const file = join(TMP, "session.jsonl");
    writeFileSync(
      file,
      jsonl(
        { type: "user", message: { content: "test" }, timestamp: 1704067200 }, // epoch seconds
        { type: "assistant", message: { content: "response" }, timestamp: 1704067200000 }, // epoch ms
      ),
    );

    const result = analyzeSessionFile(file);
    expect(result.firstTimestamp).toBeTruthy();
    expect(result.lastTimestamp).toBeTruthy();
  });
});
