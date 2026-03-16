import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdirSync, rmSync, readFileSync, writeFileSync, existsSync, statSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

// Set PROJECT_DIR before importing state module
const TEST_DIR = join(tmpdir(), `preflight-state-test-${Date.now()}`);
process.env.CLAUDE_PROJECT_DIR = TEST_DIR;

// Dynamic import to pick up env var
const { loadState, saveState, appendLog, readLog, now, STATE_DIR } = await import("../../src/lib/state.js");

describe("state.ts", () => {
  beforeEach(() => {
    mkdirSync(TEST_DIR, { recursive: true });
  });

  afterEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  describe("loadState", () => {
    it("returns empty object when file does not exist", () => {
      expect(loadState("nonexistent")).toEqual({});
    });

    it("returns parsed JSON when file exists", () => {
      const stateDir = join(TEST_DIR, ".claude", "preflight-state");
      mkdirSync(stateDir, { recursive: true });
      writeFileSync(join(stateDir, "mystate.json"), JSON.stringify({ foo: "bar" }));
      expect(loadState("mystate")).toEqual({ foo: "bar" });
    });

    it("returns empty object for corrupt JSON", () => {
      const stateDir = join(TEST_DIR, ".claude", "preflight-state");
      mkdirSync(stateDir, { recursive: true });
      writeFileSync(join(stateDir, "bad.json"), "not json{{{");
      expect(loadState("bad")).toEqual({});
    });
  });

  describe("saveState", () => {
    it("creates state dir and writes JSON file", () => {
      saveState("test", { hello: "world", count: 42 });
      const stateDir = join(TEST_DIR, ".claude", "preflight-state");
      const content = JSON.parse(readFileSync(join(stateDir, "test.json"), "utf-8"));
      expect(content).toEqual({ hello: "world", count: 42 });
    });

    it("overwrites existing state", () => {
      saveState("overwrite", { v: 1 });
      saveState("overwrite", { v: 2 });
      const stateDir = join(TEST_DIR, ".claude", "preflight-state");
      const content = JSON.parse(readFileSync(join(stateDir, "overwrite.json"), "utf-8"));
      expect(content).toEqual({ v: 2 });
    });
  });

  describe("appendLog", () => {
    it("creates log file and appends JSONL entry", () => {
      appendLog("test.jsonl", { action: "build", ts: 1 });
      const logFile = join(TEST_DIR, ".claude", "preflight-state", "test.jsonl");
      const lines = readFileSync(logFile, "utf-8").trim().split("\n");
      expect(lines).toHaveLength(1);
      expect(JSON.parse(lines[0])).toEqual({ action: "build", ts: 1 });
    });

    it("appends multiple entries", () => {
      appendLog("multi.jsonl", { n: 1 });
      appendLog("multi.jsonl", { n: 2 });
      appendLog("multi.jsonl", { n: 3 });
      const logFile = join(TEST_DIR, ".claude", "preflight-state", "multi.jsonl");
      const lines = readFileSync(logFile, "utf-8").trim().split("\n");
      expect(lines).toHaveLength(3);
      expect(JSON.parse(lines[2])).toEqual({ n: 3 });
    });

    it("rotates log when exceeding max size", () => {
      const stateDir = join(TEST_DIR, ".claude", "preflight-state");
      mkdirSync(stateDir, { recursive: true });
      const logFile = join(stateDir, "big.jsonl");
      // Write a 6MB file to exceed the 5MB threshold
      const bigLine = JSON.stringify({ data: "x".repeat(1000) }) + "\n";
      const count = Math.ceil((5.1 * 1024 * 1024) / bigLine.length);
      writeFileSync(logFile, bigLine.repeat(count));

      // Append should trigger rotation
      appendLog("big.jsonl", { after: "rotation" });

      // Old file should exist as backup
      expect(existsSync(logFile + ".old")).toBe(true);
      // New file should have only the new entry
      const newContent = readFileSync(logFile, "utf-8").trim().split("\n");
      expect(newContent).toHaveLength(1);
      expect(JSON.parse(newContent[0])).toEqual({ after: "rotation" });
    });
  });

  describe("readLog", () => {
    it("returns empty array when file does not exist", () => {
      expect(readLog("nope.jsonl")).toEqual([]);
    });

    it("reads all entries", () => {
      appendLog("read.jsonl", { a: 1 });
      appendLog("read.jsonl", { a: 2 });
      appendLog("read.jsonl", { a: 3 });
      const entries = readLog("read.jsonl");
      expect(entries).toHaveLength(3);
      expect(entries[2]).toEqual({ a: 3 });
    });

    it("returns last N entries when lastN specified", () => {
      appendLog("lastn.jsonl", { n: 1 });
      appendLog("lastn.jsonl", { n: 2 });
      appendLog("lastn.jsonl", { n: 3 });
      appendLog("lastn.jsonl", { n: 4 });
      const entries = readLog("lastn.jsonl", 2);
      expect(entries).toHaveLength(2);
      expect(entries[0]).toEqual({ n: 3 });
      expect(entries[1]).toEqual({ n: 4 });
    });

    it("skips corrupt JSONL lines gracefully", () => {
      const stateDir = join(TEST_DIR, ".claude", "preflight-state");
      mkdirSync(stateDir, { recursive: true });
      writeFileSync(join(stateDir, "mixed.jsonl"), '{"ok":1}\nBAD LINE\n{"ok":2}\n');
      const entries = readLog("mixed.jsonl");
      expect(entries).toHaveLength(2);
      expect(entries[0]).toEqual({ ok: 1 });
      expect(entries[1]).toEqual({ ok: 2 });
    });

    it("returns empty array for empty file", () => {
      const stateDir = join(TEST_DIR, ".claude", "preflight-state");
      mkdirSync(stateDir, { recursive: true });
      writeFileSync(join(stateDir, "empty.jsonl"), "");
      expect(readLog("empty.jsonl")).toEqual([]);
    });
  });

  describe("now", () => {
    it("returns a valid ISO timestamp", () => {
      const ts = now();
      expect(new Date(ts).toISOString()).toBe(ts);
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
});
