import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from "fs";
import { join } from "path";

// Point PROJECT_DIR to a temp directory before importing state
const tmpDir = join(__dirname, "__state_test_tmp__");
process.env.CLAUDE_PROJECT_DIR = tmpDir;

// Dynamic import so env var is set first
const { loadState, saveState, appendLog, readLog, now, STATE_DIR } = await import(
  "../../src/lib/state.js"
);

describe("state module", () => {
  beforeEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
    mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("loadState", () => {
    it("returns empty object when file does not exist", () => {
      expect(loadState("nonexistent")).toEqual({});
    });

    it("loads valid JSON state", () => {
      mkdirSync(STATE_DIR, { recursive: true });
      writeFileSync(join(STATE_DIR, "test.json"), '{"foo":"bar","n":42}');
      expect(loadState("test")).toEqual({ foo: "bar", n: 42 });
    });

    it("returns empty object for corrupt JSON", () => {
      mkdirSync(STATE_DIR, { recursive: true });
      writeFileSync(join(STATE_DIR, "bad.json"), "{not valid json");
      expect(loadState("bad")).toEqual({});
    });
  });

  describe("saveState", () => {
    it("creates state dir and writes JSON", () => {
      saveState("mystate", { key: "value", count: 1 });
      const raw = readFileSync(join(STATE_DIR, "mystate.json"), "utf-8");
      expect(JSON.parse(raw)).toEqual({ key: "value", count: 1 });
    });

    it("overwrites existing state", () => {
      saveState("x", { a: 1 });
      saveState("x", { b: 2 });
      expect(loadState("x")).toEqual({ b: 2 });
    });
  });

  describe("appendLog / readLog", () => {
    it("appends JSONL entries and reads them back", () => {
      appendLog("test.jsonl", { event: "start", ts: 1 });
      appendLog("test.jsonl", { event: "end", ts: 2 });
      const entries = readLog("test.jsonl");
      expect(entries).toHaveLength(2);
      expect(entries[0]).toEqual({ event: "start", ts: 1 });
      expect(entries[1]).toEqual({ event: "end", ts: 2 });
    });

    it("readLog returns empty array for missing file", () => {
      expect(readLog("nope.jsonl")).toEqual([]);
    });

    it("readLog with lastN returns only last N entries", () => {
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
      writeFileSync(
        join(STATE_DIR, "mixed.jsonl"),
        '{"ok":true}\nNOT JSON\n{"also":"ok"}\n'
      );
      const entries = readLog("mixed.jsonl");
      expect(entries).toHaveLength(2);
      expect(entries[0]).toEqual({ ok: true });
      expect(entries[1]).toEqual({ also: "ok" });
    });

    it("rotates log when exceeding 5MB", () => {
      mkdirSync(STATE_DIR, { recursive: true });
      const logPath = join(STATE_DIR, "big.jsonl");
      // Write a 5.1MB file
      const bigLine = JSON.stringify({ data: "x".repeat(1000) }) + "\n";
      const count = Math.ceil((5.1 * 1024 * 1024) / bigLine.length);
      writeFileSync(logPath, bigLine.repeat(count));

      // Append should trigger rotation
      appendLog("big.jsonl", { after: "rotation" });

      // Old file should exist as backup
      expect(existsSync(logPath + ".old")).toBe(true);
      // New file should only have the new entry
      const entries = readLog("big.jsonl");
      expect(entries).toHaveLength(1);
      expect(entries[0]).toEqual({ after: "rotation" });
    });
  });

  describe("now", () => {
    it("returns a valid ISO 8601 string", () => {
      const ts = now();
      expect(new Date(ts).toISOString()).toBe(ts);
    });
  });
});
