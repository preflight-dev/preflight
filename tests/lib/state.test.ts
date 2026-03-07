import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

const TEST_DIR = join(tmpdir(), `preflight-state-test-${process.pid}`);

// Set PROJECT_DIR before importing state module (it reads env at import time)
process.env.CLAUDE_PROJECT_DIR = TEST_DIR;

// Now import — STATE_DIR will be TEST_DIR/.claude/preflight-state
const { loadState, saveState, appendLog, readLog, now, STATE_DIR } = await import("../../src/lib/state.js");

const stateDir = join(TEST_DIR, ".claude", "preflight-state");

beforeEach(() => {
  mkdirSync(stateDir, { recursive: true });
});

afterEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
});

describe("now()", () => {
  it("returns a valid ISO timestamp", () => {
    const ts = now();
    expect(ts).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    expect(() => new Date(ts)).not.toThrow();
  });

  it("returns a timestamp close to current time", () => {
    const before = Date.now();
    const ts = now();
    const after = Date.now();
    const parsed = new Date(ts).getTime();
    expect(parsed).toBeGreaterThanOrEqual(before);
    expect(parsed).toBeLessThanOrEqual(after);
  });
});

describe("loadState / saveState", () => {
  it("returns empty object for missing state file", () => {
    expect(loadState("nonexistent")).toEqual({});
  });

  it("returns empty object for corrupt JSON", () => {
    writeFileSync(join(stateDir, "corrupt.json"), "not json{{{");
    expect(loadState("corrupt")).toEqual({});
  });

  it("round-trips a state object", () => {
    saveState("test", { foo: "bar", count: 42 });
    const result = loadState("test");
    expect(result).toEqual({ foo: "bar", count: 42 });
  });

  it("overwrites existing state", () => {
    saveState("overwrite", { version: 1 });
    saveState("overwrite", { version: 2 });
    expect(loadState("overwrite")).toEqual({ version: 2 });
  });

  it("creates state dir if it does not exist", () => {
    rmSync(stateDir, { recursive: true, force: true });
    saveState("autocreate", { ok: true });
    expect(existsSync(join(stateDir, "autocreate.json"))).toBe(true);
    expect(loadState("autocreate")).toEqual({ ok: true });
  });
});

describe("appendLog / readLog", () => {
  it("returns empty array for missing log file", () => {
    expect(readLog("missing.jsonl")).toEqual([]);
  });

  it("returns empty array for empty log file", () => {
    writeFileSync(join(stateDir, "empty.jsonl"), "");
    expect(readLog("empty.jsonl")).toEqual([]);
  });

  it("appends and reads JSONL entries", () => {
    appendLog("append.jsonl", { a: 1 });
    appendLog("append.jsonl", { b: 2 });
    appendLog("append.jsonl", { c: 3 });
    const result = readLog("append.jsonl");
    expect(result).toHaveLength(3);
    expect(result[0]).toEqual({ a: 1 });
    expect(result[2]).toEqual({ c: 3 });
  });

  it("respects lastN parameter", () => {
    for (let i = 0; i < 10; i++) {
      appendLog("many.jsonl", { i });
    }
    const result = readLog("many.jsonl", 3);
    expect(result).toHaveLength(3);
    expect(result[0]).toEqual({ i: 7 });
    expect(result[2]).toEqual({ i: 9 });
  });

  it("skips corrupt lines gracefully", () => {
    const lines = [
      JSON.stringify({ good: 1 }),
      "not json",
      JSON.stringify({ good: 2 }),
    ].join("\n");
    writeFileSync(join(stateDir, "partial.jsonl"), lines);
    const result = readLog("partial.jsonl");
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ good: 1 });
    expect(result[1]).toEqual({ good: 2 });
  });

  it("rotates log file when it exceeds 5MB", () => {
    // Write a 5MB+ entry
    const bigEntry = { data: "x".repeat(5 * 1024 * 1024) };
    appendLog("big.jsonl", bigEntry);
    // File should exist and be large
    expect(existsSync(join(stateDir, "big.jsonl"))).toBe(true);

    // Append another entry — should trigger rotation
    appendLog("big.jsonl", { after: true });

    // The .old backup should exist
    expect(existsSync(join(stateDir, "big.jsonl.old"))).toBe(true);
    // The current file should only have the new entry
    const result = readLog("big.jsonl");
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ after: true });
  });

  it("creates state dir if needed", () => {
    rmSync(stateDir, { recursive: true, force: true });
    appendLog("autocreate.jsonl", { ok: true });
    expect(readLog("autocreate.jsonl")).toEqual([{ ok: true }]);
  });
});
