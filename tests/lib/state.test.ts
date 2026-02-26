// =============================================================================
// Tests for src/lib/state.ts — state persistence and JSONL logging
// =============================================================================

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, existsSync, mkdirSync, statSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { rmSync } from "fs";

// We need to mock PROJECT_DIR before importing state functions
let tempDir: string;
let stateDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "preflight-state-test-"));
  stateDir = join(tempDir, ".claude", "preflight-state");
  // Mock the STATE_DIR and PROJECT_DIR
  vi.doMock("../../src/lib/files.js", () => ({
    PROJECT_DIR: tempDir,
  }));
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
  try {
    rmSync(tempDir, { recursive: true, force: true });
  } catch { /* cleanup best-effort */ }
});

async function getState() {
  return await import("../../src/lib/state.js");
}

describe("loadState", () => {
  it("returns empty object when file does not exist", async () => {
    const { loadState } = await getState();
    expect(loadState("nonexistent")).toEqual({});
  });

  it("loads valid JSON state file", async () => {
    const { loadState } = await getState();
    mkdirSync(stateDir, { recursive: true });
    const data = { count: 42, items: ["a", "b"] };
    writeFileSync(join(stateDir, "test.json"), JSON.stringify(data));
    expect(loadState("test")).toEqual(data);
  });

  it("returns empty object for corrupt JSON", async () => {
    const { loadState } = await getState();
    mkdirSync(stateDir, { recursive: true });
    writeFileSync(join(stateDir, "corrupt.json"), "{not valid json");
    expect(loadState("corrupt")).toEqual({});
  });
});

describe("saveState", () => {
  it("creates state dir and writes JSON file", async () => {
    const { saveState, loadState } = await getState();
    const data = { key: "value", nested: { x: 1 } };
    saveState("mystate", data);
    expect(existsSync(join(stateDir, "mystate.json"))).toBe(true);
    expect(loadState("mystate")).toEqual(data);
  });

  it("overwrites existing state file", async () => {
    const { saveState, loadState } = await getState();
    saveState("overwrite", { version: 1 });
    saveState("overwrite", { version: 2 });
    expect(loadState("overwrite")).toEqual({ version: 2 });
  });
});

describe("appendLog / readLog", () => {
  it("appends JSONL entries and reads them back", async () => {
    const { appendLog, readLog } = await getState();
    appendLog("test.jsonl", { action: "first", ts: 1 });
    appendLog("test.jsonl", { action: "second", ts: 2 });
    appendLog("test.jsonl", { action: "third", ts: 3 });

    const entries = readLog("test.jsonl");
    expect(entries).toHaveLength(3);
    expect(entries[0]).toEqual({ action: "first", ts: 1 });
    expect(entries[2]).toEqual({ action: "third", ts: 3 });
  });

  it("readLog returns empty array for missing file", async () => {
    const { readLog } = await getState();
    expect(readLog("missing.jsonl")).toEqual([]);
  });

  it("readLog with lastN returns only last N entries", async () => {
    const { appendLog, readLog } = await getState();
    for (let i = 0; i < 10; i++) {
      appendLog("big.jsonl", { i });
    }
    const last3 = readLog("big.jsonl", 3);
    expect(last3).toHaveLength(3);
    expect(last3[0]).toEqual({ i: 7 });
    expect(last3[2]).toEqual({ i: 9 });
  });

  it("readLog skips corrupt lines gracefully", async () => {
    const { readLog } = await getState();
    mkdirSync(stateDir, { recursive: true });
    const content = [
      JSON.stringify({ good: 1 }),
      "not json at all",
      JSON.stringify({ good: 2 }),
    ].join("\n");
    writeFileSync(join(stateDir, "mixed.jsonl"), content);

    const entries = readLog("mixed.jsonl");
    expect(entries).toHaveLength(2);
    expect(entries[0]).toEqual({ good: 1 });
    expect(entries[1]).toEqual({ good: 2 });
  });

  it("readLog handles empty file", async () => {
    const { readLog } = await getState();
    mkdirSync(stateDir, { recursive: true });
    writeFileSync(join(stateDir, "empty.jsonl"), "");
    expect(readLog("empty.jsonl")).toEqual([]);
  });

  it("rotates log file when exceeding 5MB", async () => {
    const { appendLog } = await getState();
    mkdirSync(stateDir, { recursive: true });

    // Create a log file > 5MB
    const logPath = join(stateDir, "big.jsonl");
    const bigData = "x".repeat(6 * 1024 * 1024); // 6MB
    writeFileSync(logPath, bigData);

    // Appending should trigger rotation
    appendLog("big.jsonl", { after: "rotation" });

    // Old file should exist as backup
    expect(existsSync(logPath + ".old")).toBe(true);
    // New file should contain only the new entry
    const newContent = readFileSync(logPath, "utf-8").trim();
    expect(JSON.parse(newContent)).toEqual({ after: "rotation" });
  });
});

describe("now", () => {
  it("returns a valid ISO timestamp", async () => {
    const { now } = await getState();
    const ts = now();
    expect(() => new Date(ts)).not.toThrow();
    expect(new Date(ts).toISOString()).toBe(ts);
  });
});
