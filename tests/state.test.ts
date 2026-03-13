import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, existsSync, mkdirSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

let tempDir: string;
let stateDir: string;

// Mock files.js to return our temp dir
vi.mock("../src/lib/files.js", () => {
  // Use a placeholder that we'll override per test via the module
  return {
    PROJECT_DIR: "/tmp/preflight-mock-placeholder",
  };
});

describe("state lib", () => {
  beforeEach(async () => {
    tempDir = mkdtempSync(join(tmpdir(), "preflight-state-test-"));
    stateDir = join(tempDir, ".claude", "preflight-state");

    // Update the mock value
    const filesModule = await import("../src/lib/files.js");
    (filesModule as any).PROJECT_DIR = tempDir;

    // Reset the state module so STATE_DIR picks up new PROJECT_DIR
    vi.resetModules();
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  async function getState() {
    // Re-mock before re-importing
    vi.doMock("../src/lib/files.js", () => ({
      PROJECT_DIR: tempDir,
    }));
    return await import("../src/lib/state.js");
  }

  describe("loadState", () => {
    it("returns empty object when file does not exist", async () => {
      const { loadState } = await getState();
      expect(loadState("nonexistent")).toEqual({});
    });

    it("returns parsed JSON when file exists", async () => {
      mkdirSync(stateDir, { recursive: true });
      writeFileSync(join(stateDir, "test.json"), JSON.stringify({ foo: "bar" }));
      const { loadState } = await getState();
      expect(loadState("test")).toEqual({ foo: "bar" });
    });

    it("returns empty object for corrupt JSON", async () => {
      mkdirSync(stateDir, { recursive: true });
      writeFileSync(join(stateDir, "bad.json"), "not json{{{");
      const { loadState } = await getState();
      expect(loadState("bad")).toEqual({});
    });
  });

  describe("saveState", () => {
    it("creates state dir and writes file", async () => {
      const { saveState } = await getState();
      saveState("mystate", { count: 42 });
      const data = JSON.parse(readFileSync(join(stateDir, "mystate.json"), "utf-8"));
      expect(data).toEqual({ count: 42 });
    });

    it("overwrites existing state", async () => {
      const { saveState } = await getState();
      saveState("mystate", { v: 1 });
      saveState("mystate", { v: 2 });
      const data = JSON.parse(readFileSync(join(stateDir, "mystate.json"), "utf-8"));
      expect(data).toEqual({ v: 2 });
    });
  });

  describe("appendLog / readLog", () => {
    it("appends entries and reads them back", async () => {
      const { appendLog, readLog } = await getState();
      appendLog("test.jsonl", { action: "a" });
      appendLog("test.jsonl", { action: "b" });
      appendLog("test.jsonl", { action: "c" });

      const entries = readLog("test.jsonl");
      expect(entries).toHaveLength(3);
      expect(entries[0]).toEqual({ action: "a" });
      expect(entries[2]).toEqual({ action: "c" });
    });

    it("readLog returns empty array for missing file", async () => {
      const { readLog } = await getState();
      expect(readLog("nope.jsonl")).toEqual([]);
    });

    it("readLog with lastN returns only last N entries", async () => {
      const { appendLog, readLog } = await getState();
      appendLog("log.jsonl", { n: 1 });
      appendLog("log.jsonl", { n: 2 });
      appendLog("log.jsonl", { n: 3 });
      appendLog("log.jsonl", { n: 4 });

      const last2 = readLog("log.jsonl", 2);
      expect(last2).toHaveLength(2);
      expect(last2[0]).toEqual({ n: 3 });
      expect(last2[1]).toEqual({ n: 4 });
    });

    it("skips corrupt lines in log", async () => {
      const { readLog } = await getState();
      mkdirSync(stateDir, { recursive: true });
      writeFileSync(
        join(stateDir, "mixed.jsonl"),
        '{"ok":true}\nnot json\n{"also":"ok"}\n'
      );
      const entries = readLog("mixed.jsonl");
      expect(entries).toHaveLength(2);
      expect(entries[0]).toEqual({ ok: true });
      expect(entries[1]).toEqual({ also: "ok" });
    });

    it("readLog returns empty for empty file", async () => {
      const { readLog } = await getState();
      mkdirSync(stateDir, { recursive: true });
      writeFileSync(join(stateDir, "empty.jsonl"), "");
      expect(readLog("empty.jsonl")).toEqual([]);
    });
  });

  describe("now", () => {
    it("returns a valid ISO string", async () => {
      const { now } = await getState();
      const ts = now();
      expect(new Date(ts).toISOString()).toBe(ts);
    });
  });
});
