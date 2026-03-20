import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

// Must use a literal or import-free expression inside vi.mock factory (hoisted)
vi.mock("../../src/lib/files.js", () => {
  const os = require("os");
  const path = require("path");
  return {
    PROJECT_DIR: path.join(os.tmpdir(), "preflight-state-test"),
  };
});

import { loadState, saveState, appendLog, readLog, now, STATE_DIR } from "../../src/lib/state.js";

const TEST_DIR = join(tmpdir(), "preflight-state-test");

describe("state", () => {
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

    it("loads valid JSON state file", () => {
      mkdirSync(STATE_DIR, { recursive: true });
      const data = { foo: "bar", count: 42 };
      writeFileSync(join(STATE_DIR, "test.json"), JSON.stringify(data));
      expect(loadState("test")).toEqual(data);
    });

    it("returns empty object for corrupt JSON", () => {
      mkdirSync(STATE_DIR, { recursive: true });
      writeFileSync(join(STATE_DIR, "corrupt.json"), "{bad json");
      expect(loadState("corrupt")).toEqual({});
    });
  });

  describe("saveState", () => {
    it("creates state dir and writes JSON", () => {
      const data = { key: "value", nested: { a: 1 } };
      saveState("mystate", data);
      const raw = readFileSync(join(STATE_DIR, "mystate.json"), "utf-8");
      expect(JSON.parse(raw)).toEqual(data);
    });

    it("overwrites existing state", () => {
      saveState("overwrite", { v: 1 });
      saveState("overwrite", { v: 2 });
      expect(loadState("overwrite")).toEqual({ v: 2 });
    });
  });

  describe("appendLog / readLog", () => {
    it("appends and reads JSONL entries", () => {
      appendLog("test.jsonl", { event: "a" });
      appendLog("test.jsonl", { event: "b" });
      appendLog("test.jsonl", { event: "c" });

      const entries = readLog("test.jsonl");
      expect(entries).toHaveLength(3);
      expect(entries[0]).toEqual({ event: "a" });
      expect(entries[2]).toEqual({ event: "c" });
    });

    it("readLog returns empty array for missing file", () => {
      expect(readLog("missing.jsonl")).toEqual([]);
    });

    it("readLog supports lastN parameter", () => {
      appendLog("last.jsonl", { n: 1 });
      appendLog("last.jsonl", { n: 2 });
      appendLog("last.jsonl", { n: 3 });

      const last2 = readLog("last.jsonl", 2);
      expect(last2).toHaveLength(2);
      expect(last2[0]).toEqual({ n: 2 });
      expect(last2[1]).toEqual({ n: 3 });
    });

    it("readLog skips corrupt lines gracefully", () => {
      mkdirSync(STATE_DIR, { recursive: true });
      writeFileSync(
        join(STATE_DIR, "mixed.jsonl"),
        '{"ok":true}\n{bad line\n{"also":"ok"}\n'
      );
      const entries = readLog("mixed.jsonl");
      expect(entries).toHaveLength(2);
      expect(entries[0]).toEqual({ ok: true });
      expect(entries[1]).toEqual({ also: "ok" });
    });

    it("rotates log when exceeding max size", () => {
      mkdirSync(STATE_DIR, { recursive: true });
      const logPath = join(STATE_DIR, "big.jsonl");
      // Write a file just over 5MB
      const bigLine = JSON.stringify({ data: "x".repeat(1000) }) + "\n";
      const count = Math.ceil((5 * 1024 * 1024) / bigLine.length) + 10;
      writeFileSync(logPath, bigLine.repeat(count));

      // Next append should trigger rotation
      appendLog("big.jsonl", { after: "rotation" });

      expect(existsSync(logPath + ".old")).toBe(true);
      // New file should only have the one new entry
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
