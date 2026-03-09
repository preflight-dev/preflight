import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "fs";
import { join } from "path";

// Point PROJECT_DIR to a temp directory before importing state
const TEST_DIR = join(import.meta.dirname ?? __dirname, "..", ".tmp-state-test");
vi.stubEnv("CLAUDE_PROJECT_DIR", TEST_DIR);

// Dynamic import so env is set first
const { loadState, saveState, appendLog, readLog, now, STATE_DIR } = await import(
  "../../src/lib/state.js"
);

describe("lib/state", () => {
  beforeEach(() => {
    // Clean slate
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true });
    }
    mkdirSync(TEST_DIR, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true });
    }
  });

  describe("loadState", () => {
    it("returns empty object when file does not exist", () => {
      expect(loadState("nonexistent")).toEqual({});
    });

    it("returns parsed JSON when file exists", () => {
      mkdirSync(STATE_DIR, { recursive: true });
      writeFileSync(join(STATE_DIR, "test.json"), JSON.stringify({ a: 1 }));
      expect(loadState("test")).toEqual({ a: 1 });
    });

    it("returns empty object on corrupt JSON", () => {
      mkdirSync(STATE_DIR, { recursive: true });
      writeFileSync(join(STATE_DIR, "bad.json"), "{not json");
      expect(loadState("bad")).toEqual({});
    });
  });

  describe("saveState", () => {
    it("creates state dir and writes JSON", () => {
      saveState("mystate", { foo: "bar" });
      const content = readFileSync(join(STATE_DIR, "mystate.json"), "utf-8");
      expect(JSON.parse(content)).toEqual({ foo: "bar" });
    });

    it("overwrites existing state", () => {
      saveState("overwrite", { v: 1 });
      saveState("overwrite", { v: 2 });
      expect(loadState("overwrite")).toEqual({ v: 2 });
    });
  });

  describe("appendLog / readLog", () => {
    it("appends entries and reads them back", () => {
      appendLog("test.jsonl", { id: 1 });
      appendLog("test.jsonl", { id: 2 });
      appendLog("test.jsonl", { id: 3 });
      const entries = readLog("test.jsonl");
      expect(entries).toHaveLength(3);
      expect(entries[0]).toEqual({ id: 1 });
      expect(entries[2]).toEqual({ id: 3 });
    });

    it("readLog returns empty array for missing file", () => {
      expect(readLog("missing.jsonl")).toEqual([]);
    });

    it("readLog supports lastN parameter", () => {
      for (let i = 0; i < 10; i++) {
        appendLog("many.jsonl", { i });
      }
      const last3 = readLog("many.jsonl", 3);
      expect(last3).toHaveLength(3);
      expect(last3[0]).toEqual({ i: 7 });
      expect(last3[2]).toEqual({ i: 9 });
    });

    it("readLog skips corrupt lines gracefully", () => {
      mkdirSync(STATE_DIR, { recursive: true });
      const logFile = join(STATE_DIR, "corrupt.jsonl");
      writeFileSync(logFile, '{"a":1}\nbroken line\n{"b":2}\n');
      const entries = readLog("corrupt.jsonl");
      expect(entries).toHaveLength(2);
      expect(entries[0]).toEqual({ a: 1 });
      expect(entries[1]).toEqual({ b: 2 });
    });

    it("rotates log file when it exceeds 5MB", () => {
      mkdirSync(STATE_DIR, { recursive: true });
      const logFile = join(STATE_DIR, "big.jsonl");
      // Write a 5MB+ file
      const bigLine = JSON.stringify({ data: "x".repeat(1000) }) + "\n";
      const count = Math.ceil((5 * 1024 * 1024) / bigLine.length) + 1;
      writeFileSync(logFile, bigLine.repeat(count));

      // Next append should trigger rotation
      appendLog("big.jsonl", { after: "rotation" });

      expect(existsSync(logFile + ".old")).toBe(true);
      // The new file should only have the latest entry
      const entries = readLog("big.jsonl");
      expect(entries).toHaveLength(1);
      expect(entries[0]).toEqual({ after: "rotation" });
    });
  });

  describe("now", () => {
    it("returns a valid ISO timestamp", () => {
      const ts = now();
      expect(() => new Date(ts)).not.toThrow();
      expect(new Date(ts).toISOString()).toBe(ts);
    });
  });
});
