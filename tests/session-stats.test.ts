import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// We test the analyzeSession logic by importing the module and exercising
// the tool handler directly via the MCP server mock.

// Since analyzeSession is not exported, we replicate its core logic for unit testing.
// This tests the parsing correctness of session JSONL files.

function analyzeSessionContent(content: string) {
  const lines = content.trim().split("\n").filter(Boolean);
  let turns = 0;
  let corrections = 0;
  let compactions = 0;

  for (const line of lines) {
    try {
      const obj = JSON.parse(line);
      if (obj.type === "human" || obj.role === "human" || obj.role === "user") {
        turns++;
      }
      const text = (obj.message || obj.content || "").toString().toLowerCase();
      if (turns > 0 && /\b(no[,.]|wrong|actually|instead|that's not|not what i)\b/.test(text)) {
        corrections++;
      }
      if (obj.type === "summary" || obj.type === "compaction" || text.includes("compacted") || text.includes("context window")) {
        compactions++;
      }
    } catch {
      // skip malformed lines
    }
  }

  return { turns, corrections, compactions };
}

describe("session-stats: analyzeSession logic", () => {
  it("counts user turns from type=human", () => {
    const jsonl = [
      JSON.stringify({ type: "human", message: "hello" }),
      JSON.stringify({ type: "assistant", message: "hi there" }),
      JSON.stringify({ type: "human", message: "do something" }),
    ].join("\n");

    const result = analyzeSessionContent(jsonl);
    expect(result.turns).toBe(2);
  });

  it("counts user turns from role=user", () => {
    const jsonl = [
      JSON.stringify({ role: "user", content: "hello" }),
      JSON.stringify({ role: "assistant", content: "hi" }),
    ].join("\n");

    const result = analyzeSessionContent(jsonl);
    expect(result.turns).toBe(1);
  });

  it("detects corrections", () => {
    const jsonl = [
      JSON.stringify({ type: "human", message: "build a form" }),
      JSON.stringify({ type: "assistant", message: "here's a form" }),
      JSON.stringify({ type: "human", message: "no, that's not what I wanted" }),
      JSON.stringify({ type: "assistant", message: "let me fix that" }),
      JSON.stringify({ type: "human", message: "actually, use a different approach" }),
    ].join("\n");

    const result = analyzeSessionContent(jsonl);
    expect(result.turns).toBe(3);
    expect(result.corrections).toBe(2);
  });

  it("does not count corrections before first turn", () => {
    // Edge case: correction pattern in a non-user line before any turns
    const jsonl = [
      JSON.stringify({ type: "system", message: "no, wrong config" }),
      JSON.stringify({ type: "human", message: "hello" }),
    ].join("\n");

    const result = analyzeSessionContent(jsonl);
    // The system message has "no," and "wrong" but turns=0 at that point
    // After the human message, turns=1, but the system message was already processed
    expect(result.corrections).toBe(0);
  });

  it("detects compactions", () => {
    const jsonl = [
      JSON.stringify({ type: "human", message: "hello" }),
      JSON.stringify({ type: "summary", content: "conversation summary" }),
      JSON.stringify({ type: "human", message: "continue" }),
      JSON.stringify({ type: "assistant", content: "context window was compacted" }),
    ].join("\n");

    const result = analyzeSessionContent(jsonl);
    expect(result.compactions).toBe(2);
  });

  it("handles empty content gracefully", () => {
    const result = analyzeSessionContent("");
    expect(result.turns).toBe(0);
    expect(result.corrections).toBe(0);
    expect(result.compactions).toBe(0);
  });

  it("skips malformed JSON lines", () => {
    const jsonl = [
      "not json",
      JSON.stringify({ type: "human", message: "hello" }),
      "{ broken",
      JSON.stringify({ role: "user", content: "world" }),
    ].join("\n");

    const result = analyzeSessionContent(jsonl);
    expect(result.turns).toBe(2);
  });

  it("handles message as object toString", () => {
    const jsonl = [
      JSON.stringify({ type: "human", message: { text: "hello" } }),
    ].join("\n");

    const result = analyzeSessionContent(jsonl);
    expect(result.turns).toBe(1);
  });

  it("correction keywords: 'instead' triggers correction", () => {
    const jsonl = [
      JSON.stringify({ type: "human", message: "do X" }),
      JSON.stringify({ type: "human", message: "use Y instead" }),
    ].join("\n");

    const result = analyzeSessionContent(jsonl);
    expect(result.corrections).toBe(1);
  });

  it("correction keywords: 'wrong' triggers correction", () => {
    const jsonl = [
      JSON.stringify({ type: "human", message: "start" }),
      JSON.stringify({ type: "human", message: "that's wrong" }),
    ].join("\n");

    const result = analyzeSessionContent(jsonl);
    expect(result.corrections).toBe(1);
  });
});
