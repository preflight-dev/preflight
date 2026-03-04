import { describe, it, expect, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

const testDir = mkdtempSync(join(tmpdir(), "preflight-state-test-"));

vi.mock("../../src/lib/files.js", () => ({
  PROJECT_DIR: testDir,
}));

const { loadState, saveState, appendLog, readLog, now, STATE_DIR } = await import("../../src/lib/state.js");

function ensureDir() {
  if (!existsSync(STATE_DIR)) mkdirSync(STATE_DIR, { recursive: true });
}

describe("state", () => {
  afterEach(() => {
    try { rmSync(STATE_DIR, { recursive: true, force: true }); } catch {}
  });

  describe("loadState", () => {
    it("returns empty object for missing file", () => {
      expect(loadState("nonexistent")).toEqual({});
    });

    it("returns empty object for corrupt JSON", () => {
      ensureDir();
      writeFileSync(join(STATE_DIR, "corrupt.json"), "not json{{{");
      expect(loadState("corrupt")).toEqual({});
    });

    it("loads valid state", () => {
      ensureDir();
      const data = { foo: "bar", count: 42 };
      writeFileSync(join(STATE_DIR, "valid.json"), JSON.stringify(data));
      expect(loadState("valid")).toEqual(data);
    });
  });

  describe("saveState", () => {
    it("creates state dir and writes file", () => {
      saveState("test", { hello: "world" });
      const content = JSON.parse(readFileSync(join(STATE_DIR, "test.json"), "utf-8"));
      expect(content).toEqual({ hello: "world" });
    });

    it("overwrites existing state", () => {
      saveState("overwrite", { v: 1 });
      saveState("overwrite", { v: 2 });
      expect(JSON.parse(readFileSync(join(STATE_DIR, "overwrite.json"), "utf-8"))).toEqual({ v: 2 });
    });
  });

  describe("appendLog / readLog", () => {
    it("appends entries and reads them back", () => {
      appendLog("test.jsonl", { action: "a" });
      appendLog("test.jsonl", { action: "b" });
      appendLog("test.jsonl", { action: "c" });
      const entries = readLog("test.jsonl");
      expect(entries).toHaveLength(3);
      expect(entries[0]).toEqual({ action: "a" });
      expect(entries[2]).toEqual({ action: "c" });
    });

    it("returns empty array for missing log", () => {
      expect(readLog("missing.jsonl")).toEqual([]);
    });

    it("supports lastN parameter", () => {
      appendLog("last.jsonl", { n: 1 });
      appendLog("last.jsonl", { n: 2 });
      appendLog("last.jsonl", { n: 3 });
      const last2 = readLog("last.jsonl", 2);
      expect(last2).toHaveLength(2);
      expect(last2[0]).toEqual({ n: 2 });
      expect(last2[1]).toEqual({ n: 3 });
    });

    it("skips corrupt lines gracefully", () => {
      ensureDir();
      writeFileSync(
        join(STATE_DIR, "mixed.jsonl"),
        '{"ok":true}\nnot json\n{"also":"ok"}\n'
      );
      const entries = readLog("mixed.jsonl");
      expect(entries).toHaveLength(2);
      expect(entries[0]).toEqual({ ok: true });
      expect(entries[1]).toEqual({ also: "ok" });
    });
  });

  describe("now", () => {
    it("returns a valid ISO string", () => {
      const ts = now();
      expect(new Date(ts).toISOString()).toBe(ts);
    });
  });
});
