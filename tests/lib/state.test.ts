import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from "fs";
import { join } from "path";

// Override PROJECT_DIR before importing state module
const TEST_DIR = join(__dirname, ".tmp-state-test");
process.env.CLAUDE_PROJECT_DIR = TEST_DIR;

// Dynamic import to pick up env override
let state: typeof import("../../src/lib/state.js");

beforeEach(async () => {
  rmSync(TEST_DIR, { recursive: true, force: true });
  mkdirSync(TEST_DIR, { recursive: true });
  // Re-import to get fresh module (PROJECT_DIR is read at import time via files.ts)
  state = await import("../../src/lib/state.js");
});

afterEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
});

describe("loadState / saveState", () => {
  it("returns empty object for missing file", () => {
    expect(state.loadState("nonexistent")).toEqual({});
  });

  it("round-trips JSON data", () => {
    state.saveState("test", { foo: "bar", count: 42 });
    const loaded = state.loadState("test");
    expect(loaded).toEqual({ foo: "bar", count: 42 });
  });

  it("returns empty object for corrupt JSON", () => {
    const stateDir = join(TEST_DIR, ".claude", "preflight-state");
    mkdirSync(stateDir, { recursive: true });
    writeFileSync(join(stateDir, "corrupt.json"), "not json {{{");
    expect(state.loadState("corrupt")).toEqual({});
  });

  it("creates state directory if missing", () => {
    const stateDir = join(TEST_DIR, ".claude", "preflight-state");
    expect(existsSync(stateDir)).toBe(false);
    state.saveState("auto", { x: 1 });
    expect(existsSync(stateDir)).toBe(true);
  });
});

describe("appendLog / readLog", () => {
  it("returns empty array for missing log", () => {
    expect(state.readLog("missing.jsonl")).toEqual([]);
  });

  it("appends and reads JSONL entries", () => {
    state.appendLog("test.jsonl", { action: "start", ts: 1 });
    state.appendLog("test.jsonl", { action: "end", ts: 2 });
    const entries = state.readLog("test.jsonl");
    expect(entries).toHaveLength(2);
    expect(entries[0]).toEqual({ action: "start", ts: 1 });
    expect(entries[1]).toEqual({ action: "end", ts: 2 });
  });

  it("respects lastN parameter", () => {
    for (let i = 0; i < 10; i++) {
      state.appendLog("many.jsonl", { i });
    }
    const last3 = state.readLog("many.jsonl", 3);
    expect(last3).toHaveLength(3);
    expect(last3[0]).toEqual({ i: 7 });
    expect(last3[2]).toEqual({ i: 9 });
  });

  it("skips corrupt lines gracefully", () => {
    const stateDir = join(TEST_DIR, ".claude", "preflight-state");
    mkdirSync(stateDir, { recursive: true });
    writeFileSync(
      join(stateDir, "mixed.jsonl"),
      '{"ok":true}\nnot json\n{"also":"ok"}\n'
    );
    const entries = state.readLog("mixed.jsonl");
    expect(entries).toHaveLength(2);
    expect(entries[0]).toEqual({ ok: true });
    expect(entries[1]).toEqual({ also: "ok" });
  });
});

describe("now", () => {
  it("returns a valid ISO timestamp", () => {
    const ts = state.now();
    expect(() => new Date(ts)).not.toThrow();
    expect(new Date(ts).toISOString()).toBe(ts);
  });
});
