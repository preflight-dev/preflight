import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync, existsSync, appendFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

// Create a temp project dir and set env before importing
const tempProject = mkdtempSync(join(tmpdir(), "preflight-state-test-"));
process.env.CLAUDE_PROJECT_DIR = tempProject;

// Import after env is set so PROJECT_DIR picks up our temp dir
const { loadState, saveState, appendLog, readLog, now } = await import("../../src/lib/state.js");
const stateDir = join(tempProject, ".claude", "preflight-state");

afterAll(() => {
  rmSync(tempProject, { recursive: true, force: true });
  delete process.env.CLAUDE_PROJECT_DIR;
});

describe("state", () => {
  describe("loadState / saveState", () => {
    it("returns empty object for missing state file", () => {
      expect(loadState("nonexistent")).toEqual({});
    });

    it("round-trips state data", () => {
      const data = { count: 42, items: ["a", "b"], nested: { x: true } };
      saveState("roundtrip", data);
      expect(loadState("roundtrip")).toEqual(data);
    });

    it("returns empty object for corrupt JSON", () => {
      saveState("corrupt", { ok: true });
      writeFileSync(join(stateDir, "corrupt.json"), "{not valid json");
      expect(loadState("corrupt")).toEqual({});
    });

    it("overwrites existing state", () => {
      saveState("overwrite", { v: 1 });
      saveState("overwrite", { v: 2 });
      expect(loadState("overwrite")).toEqual({ v: 2 });
    });
  });

  describe("appendLog / readLog", () => {
    it("returns empty array for missing log", () => {
      expect(readLog("missing.jsonl")).toEqual([]);
    });

    it("appends and reads log entries", () => {
      appendLog("test.jsonl", { action: "start", ts: 1 });
      appendLog("test.jsonl", { action: "end", ts: 2 });
      const entries = readLog("test.jsonl");
      expect(entries).toHaveLength(2);
      expect(entries[0]).toEqual({ action: "start", ts: 1 });
      expect(entries[1]).toEqual({ action: "end", ts: 2 });
    });

    it("supports lastN parameter", () => {
      for (let i = 0; i < 10; i++) {
        appendLog("many.jsonl", { i });
      }
      const last3 = readLog("many.jsonl", 3);
      expect(last3).toHaveLength(3);
      expect(last3[0]).toEqual({ i: 7 });
      expect(last3[2]).toEqual({ i: 9 });
    });

    it("skips corrupt lines gracefully", () => {
      appendLog("mixed.jsonl", { good: true });
      const logPath = join(stateDir, "mixed.jsonl");
      appendFileSync(logPath, "not json\n");
      appendLog("mixed.jsonl", { also: "good" });

      const entries = readLog("mixed.jsonl");
      expect(entries).toHaveLength(2);
      expect(entries[0]).toEqual({ good: true });
      expect(entries[1]).toEqual({ also: "good" });
    });
  });

  describe("now", () => {
    it("returns a valid ISO timestamp", () => {
      const ts = now();
      expect(ts).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
      expect(new Date(ts).getTime()).toBeGreaterThan(0);
    });
  });
});
