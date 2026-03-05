import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync, readFileSync, writeFileSync, existsSync, statSync } from "fs";
import { join } from "path";

// We need to override PROJECT_DIR before importing state, so we mock files.ts
const TEST_DIR = join(import.meta.dirname ?? __dirname, ".tmp-state-test");
const TEST_STATE_DIR = join(TEST_DIR, ".claude", "preflight-state");

import { vi } from "vitest";

vi.mock("../../src/lib/files.js", () => ({
  PROJECT_DIR: join(import.meta.dirname ?? __dirname, ".tmp-state-test"),
}));

// Import after mock
const { loadState, saveState, appendLog, readLog, now, STATE_DIR } = await import("../../src/lib/state.js");

describe("state module", () => {
  beforeEach(() => {
    // Clean slate
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  afterEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  describe("loadState", () => {
    it("returns empty object for missing file", () => {
      expect(loadState("nonexistent")).toEqual({});
    });

    it("returns empty object for corrupt JSON", () => {
      mkdirSync(TEST_STATE_DIR, { recursive: true });
      writeFileSync(join(TEST_STATE_DIR, "bad.json"), "not json{{{");
      expect(loadState("bad")).toEqual({});
    });

    it("loads valid JSON state", () => {
      mkdirSync(TEST_STATE_DIR, { recursive: true });
      const data = { foo: "bar", count: 42 };
      writeFileSync(join(TEST_STATE_DIR, "good.json"), JSON.stringify(data));
      expect(loadState("good")).toEqual(data);
    });
  });

  describe("saveState", () => {
    it("creates state dir and file", () => {
      expect(existsSync(TEST_STATE_DIR)).toBe(false);
      saveState("test", { hello: "world" });
      expect(existsSync(TEST_STATE_DIR)).toBe(true);
      const content = JSON.parse(readFileSync(join(TEST_STATE_DIR, "test.json"), "utf-8"));
      expect(content).toEqual({ hello: "world" });
    });

    it("overwrites existing state", () => {
      saveState("overwrite", { v: 1 });
      saveState("overwrite", { v: 2 });
      expect(loadState("overwrite")).toEqual({ v: 2 });
    });
  });

  describe("appendLog", () => {
    it("creates log file and appends entries", () => {
      appendLog("test.jsonl", { action: "first" });
      appendLog("test.jsonl", { action: "second" });

      const content = readFileSync(join(TEST_STATE_DIR, "test.jsonl"), "utf-8");
      const lines = content.trim().split("\n");
      expect(lines).toHaveLength(2);
      expect(JSON.parse(lines[0])).toEqual({ action: "first" });
      expect(JSON.parse(lines[1])).toEqual({ action: "second" });
    });

    it("rotates when file exceeds 5MB", () => {
      mkdirSync(TEST_STATE_DIR, { recursive: true });
      const logPath = join(TEST_STATE_DIR, "big.jsonl");
      // Create a file just over 5MB
      const bigLine = JSON.stringify({ data: "x".repeat(1000) }) + "\n";
      const lines = Math.ceil((5 * 1024 * 1024 + 1) / bigLine.length);
      writeFileSync(logPath, bigLine.repeat(lines));

      expect(statSync(logPath).size).toBeGreaterThan(5 * 1024 * 1024);

      // Appending should trigger rotation
      appendLog("big.jsonl", { action: "after-rotate" });

      // Old file should exist as backup
      expect(existsSync(logPath + ".old")).toBe(true);
      // New file should only have the one new entry
      const newContent = readFileSync(logPath, "utf-8").trim();
      expect(newContent.split("\n")).toHaveLength(1);
      expect(JSON.parse(newContent)).toEqual({ action: "after-rotate" });
    });
  });

  describe("readLog", () => {
    it("returns empty array for missing file", () => {
      expect(readLog("missing.jsonl")).toEqual([]);
    });

    it("reads all entries", () => {
      appendLog("read.jsonl", { n: 1 });
      appendLog("read.jsonl", { n: 2 });
      appendLog("read.jsonl", { n: 3 });

      const entries = readLog("read.jsonl");
      expect(entries).toHaveLength(3);
      expect(entries[2]).toEqual({ n: 3 });
    });

    it("returns last N entries when specified", () => {
      appendLog("tail.jsonl", { n: 1 });
      appendLog("tail.jsonl", { n: 2 });
      appendLog("tail.jsonl", { n: 3 });
      appendLog("tail.jsonl", { n: 4 });

      const last2 = readLog("tail.jsonl", 2);
      expect(last2).toHaveLength(2);
      expect(last2[0]).toEqual({ n: 3 });
      expect(last2[1]).toEqual({ n: 4 });
    });

    it("skips corrupt lines gracefully", () => {
      mkdirSync(TEST_STATE_DIR, { recursive: true });
      const logPath = join(TEST_STATE_DIR, "mixed.jsonl");
      writeFileSync(logPath, '{"a":1}\ngarbage\n{"b":2}\n');

      const entries = readLog("mixed.jsonl");
      expect(entries).toHaveLength(2);
      expect(entries[0]).toEqual({ a: 1 });
      expect(entries[1]).toEqual({ b: 2 });
    });

    it("returns empty array for empty file", () => {
      mkdirSync(TEST_STATE_DIR, { recursive: true });
      writeFileSync(join(TEST_STATE_DIR, "empty.jsonl"), "");
      expect(readLog("empty.jsonl")).toEqual([]);
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
