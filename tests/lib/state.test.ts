import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdirSync, rmSync, existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";

// Mock PROJECT_DIR before importing state module
const TEST_DIR = join(import.meta.dirname ?? __dirname, ".tmp-state-test");
vi.mock("../../src/lib/files.js", () => ({
  PROJECT_DIR: join(import.meta.dirname ?? __dirname, ".tmp-state-test"),
}));

// Import after mock
const { loadState, saveState, appendLog, readLog, now } = await import("../../src/lib/state.js");

const STATE_DIR = join(TEST_DIR, ".claude", "preflight-state");

describe("state", () => {
  beforeEach(() => {
    // Clean slate
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  afterEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  describe("loadState / saveState", () => {
    it("returns empty object when file does not exist", () => {
      expect(loadState("nonexistent")).toEqual({});
    });

    it("round-trips JSON state", () => {
      const data = { count: 42, items: ["a", "b"], nested: { ok: true } };
      saveState("mystate", data);
      expect(loadState("mystate")).toEqual(data);
    });

    it("returns empty object on corrupt JSON", () => {
      mkdirSync(STATE_DIR, { recursive: true });
      writeFileSync(join(STATE_DIR, "bad.json"), "NOT JSON{{{");
      expect(loadState("bad")).toEqual({});
    });

    it("overwrites existing state", () => {
      saveState("x", { v: 1 });
      saveState("x", { v: 2 });
      expect(loadState("x")).toEqual({ v: 2 });
    });
  });

  describe("appendLog / readLog", () => {
    it("returns empty array when log does not exist", () => {
      expect(readLog("missing.jsonl")).toEqual([]);
    });

    it("appends and reads JSONL entries", () => {
      appendLog("test.jsonl", { action: "create", id: 1 });
      appendLog("test.jsonl", { action: "update", id: 2 });
      appendLog("test.jsonl", { action: "delete", id: 3 });

      const entries = readLog("test.jsonl");
      expect(entries).toHaveLength(3);
      expect(entries[0]).toEqual({ action: "create", id: 1 });
      expect(entries[2]).toEqual({ action: "delete", id: 3 });
    });

    it("supports lastN parameter", () => {
      for (let i = 0; i < 10; i++) {
        appendLog("big.jsonl", { i });
      }
      const last3 = readLog("big.jsonl", 3);
      expect(last3).toHaveLength(3);
      expect(last3[0]).toEqual({ i: 7 });
      expect(last3[2]).toEqual({ i: 9 });
    });

    it("skips corrupt lines gracefully", () => {
      mkdirSync(STATE_DIR, { recursive: true });
      const logPath = join(STATE_DIR, "mixed.jsonl");
      writeFileSync(logPath, '{"ok":true}\nBROKEN\n{"also":"ok"}\n');
      const entries = readLog("mixed.jsonl");
      expect(entries).toHaveLength(2);
      expect(entries[0]).toEqual({ ok: true });
      expect(entries[1]).toEqual({ also: "ok" });
    });

    it("rotates log when exceeding 5MB", () => {
      mkdirSync(STATE_DIR, { recursive: true });
      const logPath = join(STATE_DIR, "large.jsonl");
      // Write a file just over 5MB
      const bigLine = JSON.stringify({ data: "x".repeat(1000) }) + "\n";
      const count = Math.ceil((5 * 1024 * 1024) / bigLine.length) + 1;
      writeFileSync(logPath, bigLine.repeat(count));

      // Append should trigger rotation
      appendLog("large.jsonl", { after: "rotate" });

      // Old file should exist as backup
      expect(existsSync(logPath + ".old")).toBe(true);
      // New file should contain just the appended entry
      const entries = readLog("large.jsonl");
      expect(entries).toHaveLength(1);
      expect(entries[0]).toEqual({ after: "rotate" });
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
