/**
 * Tests for session-parser.ts — JSONL session parsing into timeline events.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, statSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
  findSessionFiles,
  parseSession,
  parseSessionAsync,
  parseAllSessions,
  type TimelineEvent,
} from "../../src/lib/session-parser.js";

// ── Helpers ────────────────────────────────────────────────────────────────

function tmpDir(): string {
  return mkdtempSync(join(tmpdir(), "preflight-test-"));
}

function writeJsonl(dir: string, name: string, records: any[]): string {
  const p = join(dir, name);
  writeFileSync(p, records.map((r) => JSON.stringify(r)).join("\n") + "\n");
  return p;
}

// ── findSessionFiles ───────────────────────────────────────────────────────

describe("findSessionFiles", () => {
  let dir: string;
  afterEach(() => dir && rmSync(dir, { recursive: true, force: true }));

  it("returns empty array for non-existent directory", () => {
    expect(findSessionFiles("/tmp/does-not-exist-xyz")).toEqual([]);
  });

  it("discovers .jsonl files at top level", () => {
    dir = tmpDir();
    writeFileSync(join(dir, "abc.jsonl"), "{}");
    writeFileSync(join(dir, "def.jsonl"), "{}");
    writeFileSync(join(dir, "readme.txt"), "hi");

    const files = findSessionFiles(dir);
    expect(files).toHaveLength(2);
    expect(files.map((f) => f.sessionId).sort()).toEqual(["abc", "def"]);
  });

  it("discovers subagent .jsonl files", () => {
    dir = tmpDir();
    const subDir = join(dir, "session-1", "subagents");
    mkdirSync(subDir, { recursive: true });
    writeFileSync(join(subDir, "sub-agent-1.jsonl"), "{}");

    const files = findSessionFiles(dir);
    expect(files).toHaveLength(1);
    expect(files[0].sessionId).toBe("sub-agent-1");
  });
});

// ── parseSession ───────────────────────────────────────────────────────────

describe("parseSession", () => {
  let dir: string;
  afterEach(() => dir && rmSync(dir, { recursive: true, force: true }));

  it("parses user prompts", () => {
    dir = tmpDir();
    const file = writeJsonl(dir, "s1.jsonl", [
      { type: "user", message: { content: "Add a login page" }, timestamp: "2026-01-15T10:00:00Z" },
    ]);

    const events = parseSession(file, "/proj", "proj");
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("prompt");
    expect(events[0].content).toBe("Add a login page");
    expect(events[0].timestamp).toBe("2026-01-15T10:00:00.000Z");
  });

  it("parses assistant text responses", () => {
    dir = tmpDir();
    const file = writeJsonl(dir, "s1.jsonl", [
      { type: "assistant", message: { content: "Done!" }, timestamp: "2026-01-15T10:01:00Z" },
    ]);

    const events = parseSession(file, "/proj", "proj");
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("assistant");
  });

  it("parses assistant content blocks (array format)", () => {
    dir = tmpDir();
    const file = writeJsonl(dir, "s1.jsonl", [
      {
        type: "assistant",
        message: {
          content: [
            { type: "text", text: "Here's the code" },
            { type: "tool_use", name: "Write", input: { path: "foo.ts" } },
          ],
        },
        timestamp: "2026-01-15T10:01:00Z",
      },
    ]);

    const events = parseSession(file, "/proj", "proj");
    // Should produce: assistant text + tool_call
    expect(events).toHaveLength(2);
    expect(events[0].type).toBe("assistant");
    expect(events[1].type).toBe("tool_call");
    expect(events[1].content).toContain("Write");
  });

  it("detects correction patterns", () => {
    dir = tmpDir();
    const file = writeJsonl(dir, "s1.jsonl", [
      { type: "assistant", message: { content: "I created the component" }, timestamp: "2026-01-15T10:00:00Z" },
      { type: "user", message: { content: "No, I meant the other one" }, timestamp: "2026-01-15T10:01:00Z" },
    ]);

    const events = parseSession(file, "/proj", "proj");
    const userEvent = events.find((e) => e.type === "correction" || e.type === "prompt");
    expect(userEvent?.type).toBe("correction");
  });

  it("detects sub-agent spawns (Task tool)", () => {
    dir = tmpDir();
    const file = writeJsonl(dir, "s1.jsonl", [
      {
        type: "assistant",
        message: {
          content: [{ type: "tool_use", name: "Task", input: { description: "refactor auth" } }],
        },
        timestamp: "2026-01-15T10:00:00Z",
      },
    ]);

    const events = parseSession(file, "/proj", "proj");
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("sub_agent_spawn");
  });

  it("detects dispatch_agent as sub-agent spawn", () => {
    dir = tmpDir();
    const file = writeJsonl(dir, "s1.jsonl", [
      {
        type: "assistant",
        message: {
          content: [{ type: "tool_use", name: "dispatch_agent", input: {} }],
        },
        timestamp: "2026-01-15T10:00:00Z",
      },
    ]);

    const events = parseSession(file, "/proj", "proj");
    expect(events[0].type).toBe("sub_agent_spawn");
  });

  it("parses tool_result errors", () => {
    dir = tmpDir();
    const file = writeJsonl(dir, "s1.jsonl", [
      { type: "tool_result", is_error: true, content: "ENOENT: file not found", timestamp: "2026-01-15T10:00:00Z" },
    ]);

    const events = parseSession(file, "/proj", "proj");
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("error");
  });

  it("parses compaction events", () => {
    dir = tmpDir();
    const file = writeJsonl(dir, "s1.jsonl", [
      { type: "system", message: { content: "Context compacted to save tokens" }, timestamp: "2026-01-15T10:00:00Z" },
    ]);

    const events = parseSession(file, "/proj", "proj");
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("compaction");
  });

  it("extracts branch from summary records", () => {
    dir = tmpDir();
    const file = writeJsonl(dir, "s1.jsonl", [
      { type: "summary", gitBranch: "feat/login", sessionId: "sess-42" },
      { type: "user", message: { content: "Hello" }, timestamp: "2026-01-15T10:00:00Z" },
    ]);

    const events = parseSession(file, "/proj", "proj");
    expect(events).toHaveLength(1);
    expect(events[0].branch).toBe("feat/login");
    expect(events[0].session_id).toBe("sess-42");
  });

  it("handles malformed JSON lines gracefully", () => {
    dir = tmpDir();
    const file = join(dir, "bad.jsonl");
    writeFileSync(file, '{"type":"user","message":{"content":"ok"},"timestamp":"2026-01-15T10:00:00Z"}\nNOT JSON\n');

    // Should not throw, should parse the valid line
    const events = parseSession(file, "/proj", "proj");
    expect(events).toHaveLength(1);
  });

  it("normalizes epoch timestamps", () => {
    dir = tmpDir();
    const file = writeJsonl(dir, "s1.jsonl", [
      { type: "user", message: { content: "test" }, timestamp: 1705312800 },
    ]);

    const events = parseSession(file, "/proj", "proj");
    expect(events[0].timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("skips empty user messages", () => {
    dir = tmpDir();
    const file = writeJsonl(dir, "s1.jsonl", [
      { type: "user", message: { content: "" }, timestamp: "2026-01-15T10:00:00Z" },
    ]);

    const events = parseSession(file, "/proj", "proj");
    expect(events).toHaveLength(0);
  });
});

// ── parseSessionAsync ──────────────────────────────────────────────────────

describe("parseSessionAsync", () => {
  let dir: string;
  afterEach(() => dir && rmSync(dir, { recursive: true, force: true }));

  it("produces same results as sync parser", async () => {
    dir = tmpDir();
    const records = [
      { type: "summary", gitBranch: "main", sessionId: "s1" },
      { type: "user", message: { content: "Hello world" }, timestamp: "2026-01-15T10:00:00Z" },
      { type: "assistant", message: { content: "Hi there" }, timestamp: "2026-01-15T10:00:01Z" },
      { type: "user", message: { content: "No, wrong answer" }, timestamp: "2026-01-15T10:00:02Z" },
    ];
    const file = writeJsonl(dir, "s1.jsonl", records);

    const syncEvents = parseSession(file, "/proj", "proj");
    const asyncEvents = await parseSessionAsync(file, "/proj", "proj");

    expect(asyncEvents).toHaveLength(syncEvents.length);
    // Types should match (ids will differ)
    expect(asyncEvents.map((e) => e.type)).toEqual(syncEvents.map((e) => e.type));
    expect(asyncEvents.map((e) => e.content)).toEqual(syncEvents.map((e) => e.content));
  });
});

// ── parseAllSessions ───────────────────────────────────────────────────────

describe("parseAllSessions", () => {
  let dir: string;
  afterEach(() => dir && rmSync(dir, { recursive: true, force: true }));

  it("parses all jsonl files and sorts by timestamp", () => {
    dir = tmpDir();
    writeJsonl(dir, "a.jsonl", [
      { type: "user", message: { content: "second" }, timestamp: "2026-01-15T10:01:00Z" },
    ]);
    writeJsonl(dir, "b.jsonl", [
      { type: "user", message: { content: "first" }, timestamp: "2026-01-15T10:00:00Z" },
    ]);

    const events = parseAllSessions(dir);
    expect(events).toHaveLength(2);
    expect(events[0].content).toBe("first");
    expect(events[1].content).toBe("second");
  });

  it("filters by since date", () => {
    dir = tmpDir();
    const oldFile = writeJsonl(dir, "old.jsonl", [
      { type: "user", message: { content: "old" }, timestamp: "2025-01-01T00:00:00Z" },
    ]);
    // Touch the old file to make its mtime old
    const past = new Date("2025-01-01");
    const { utimesSync } = require("fs");
    utimesSync(oldFile, past, past);

    writeJsonl(dir, "new.jsonl", [
      { type: "user", message: { content: "new" }, timestamp: "2026-01-15T10:00:00Z" },
    ]);

    const events = parseAllSessions(dir, { since: new Date("2026-01-01") });
    expect(events).toHaveLength(1);
    expect(events[0].content).toBe("new");
  });
});
