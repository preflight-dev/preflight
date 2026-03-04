/**
 * Tests for src/lib/session-parser.ts
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { writeFileSync, mkdirSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { randomUUID } from "crypto";

// We test the exported functions
import {
  findSessionFiles,
  parseSession,
  parseSessionAsync,
  parseAllSessions,
} from "../../src/lib/session-parser.js";

// ── Helpers ────────────────────────────────────────────────────────────────

function makeTmpDir(): string {
  const dir = join(tmpdir(), `preflight-test-${randomUUID()}`);
  mkdirSync(dir, { recursive: true });
  return dir;
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

  it("returns empty for non-existent directory", () => {
    expect(findSessionFiles("/tmp/does-not-exist-" + randomUUID())).toEqual([]);
  });

  it("finds .jsonl files at top level", () => {
    dir = makeTmpDir();
    writeFileSync(join(dir, "abc.jsonl"), "{}");
    writeFileSync(join(dir, "readme.txt"), "hi");
    const files = findSessionFiles(dir);
    expect(files).toHaveLength(1);
    expect(files[0].sessionId).toBe("abc");
  });

  it("finds subagent session files", () => {
    dir = makeTmpDir();
    const parentId = randomUUID();
    const subDir = join(dir, parentId, "subagents");
    mkdirSync(subDir, { recursive: true });
    writeFileSync(join(subDir, "sub1.jsonl"), "{}");
    const files = findSessionFiles(dir);
    expect(files.some((f) => f.sessionId === "sub1")).toBe(true);
  });
});

// ── parseSession ───────────────────────────────────────────────────────────

describe("parseSession", () => {
  let dir: string;
  afterEach(() => dir && rmSync(dir, { recursive: true, force: true }));

  it("parses user prompts", () => {
    dir = makeTmpDir();
    const file = writeJsonl(dir, "s1.jsonl", [
      { type: "user", message: { content: "fix the bug" }, timestamp: "2025-01-01T00:00:00Z" },
    ]);
    const events = parseSession(file, "/test", "test");
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("prompt");
    expect(events[0].content).toBe("fix the bug");
  });

  it("parses assistant responses with text blocks", () => {
    dir = makeTmpDir();
    const file = writeJsonl(dir, "s1.jsonl", [
      {
        type: "assistant",
        message: { content: [{ type: "text", text: "I fixed it" }] },
        timestamp: "2025-01-01T00:01:00Z",
        model: "claude-4",
      },
    ]);
    const events = parseSession(file, "/test", "test");
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("assistant");
    expect(events[0].content).toBe("I fixed it");
    expect(JSON.parse(events[0].metadata).model).toBe("claude-4");
  });

  it("extracts tool_use blocks as tool_call events", () => {
    dir = makeTmpDir();
    const file = writeJsonl(dir, "s1.jsonl", [
      {
        type: "assistant",
        message: {
          content: [
            { type: "tool_use", name: "Read", input: { path: "/foo" } },
          ],
        },
        timestamp: "2025-01-01T00:01:00Z",
      },
    ]);
    const events = parseSession(file, "/test", "test");
    expect(events.some((e) => e.type === "tool_call")).toBe(true);
    expect(events.find((e) => e.type === "tool_call")!.content).toContain("Read");
  });

  it("detects sub_agent_spawn for Task tool", () => {
    dir = makeTmpDir();
    const file = writeJsonl(dir, "s1.jsonl", [
      {
        type: "assistant",
        message: {
          content: [{ type: "tool_use", name: "Task", input: { description: "do stuff" } }],
        },
        timestamp: "2025-01-01T00:01:00Z",
      },
    ]);
    const events = parseSession(file, "/test", "test");
    expect(events.some((e) => e.type === "sub_agent_spawn")).toBe(true);
  });

  it("detects corrections after assistant messages", () => {
    dir = makeTmpDir();
    const file = writeJsonl(dir, "s1.jsonl", [
      { type: "assistant", message: { content: "here you go" }, timestamp: "2025-01-01T00:00:00Z" },
      { type: "user", message: { content: "no, wrong, I meant the other file" }, timestamp: "2025-01-01T00:01:00Z" },
    ]);
    const events = parseSession(file, "/test", "test");
    const correction = events.find((e) => e.type === "correction");
    expect(correction).toBeDefined();
    expect(correction!.content).toContain("wrong");
  });

  it("detects error tool_results", () => {
    dir = makeTmpDir();
    const file = writeJsonl(dir, "s1.jsonl", [
      { type: "tool_result", is_error: true, content: "command failed", timestamp: "2025-01-01T00:00:00Z" },
    ]);
    const events = parseSession(file, "/test", "test");
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("error");
  });

  it("detects compaction events", () => {
    dir = makeTmpDir();
    const file = writeJsonl(dir, "s1.jsonl", [
      { type: "system", subtype: "compaction", content: "context compacted", timestamp: "2025-01-01T00:00:00Z" },
    ]);
    const events = parseSession(file, "/test", "test");
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("compaction");
  });

  it("handles summary records for branch and sessionId", () => {
    dir = makeTmpDir();
    const file = writeJsonl(dir, "s1.jsonl", [
      { type: "summary", gitBranch: "main", sessionId: "sess-123" },
      { type: "user", message: { content: "hello" }, timestamp: "2025-01-01T00:00:00Z" },
    ]);
    const events = parseSession(file, "/test", "test");
    expect(events).toHaveLength(1);
    expect(events[0].branch).toBe("main");
    expect(events[0].session_id).toBe("sess-123");
  });

  it("skips malformed JSON lines gracefully", () => {
    dir = makeTmpDir();
    const p = join(dir, "bad.jsonl");
    writeFileSync(p, '{"type":"user","message":{"content":"ok"},"timestamp":"2025-01-01T00:00:00Z"}\nNOT JSON\n');
    const events = parseSession(p, "/test", "test");
    expect(events).toHaveLength(1);
  });

  it("handles epoch timestamps", () => {
    dir = makeTmpDir();
    const file = writeJsonl(dir, "s1.jsonl", [
      { type: "user", message: { content: "hi" }, timestamp: 1704067200 },
    ]);
    const events = parseSession(file, "/test", "test");
    expect(events[0].timestamp).toBe("2024-01-01T00:00:00.000Z");
  });

  it("handles epoch ms timestamps", () => {
    dir = makeTmpDir();
    const file = writeJsonl(dir, "s1.jsonl", [
      { type: "user", message: { content: "hi" }, timestamp: 1704067200000 },
    ]);
    const events = parseSession(file, "/test", "test");
    expect(events[0].timestamp).toBe("2024-01-01T00:00:00.000Z");
  });
});

// ── parseSessionAsync ──────────────────────────────────────────────────────

describe("parseSessionAsync", () => {
  let dir: string;
  afterEach(() => dir && rmSync(dir, { recursive: true, force: true }));

  it("produces same results as sync parser", async () => {
    dir = makeTmpDir();
    const records = [
      { type: "summary", gitBranch: "feat", sessionId: "s1" },
      { type: "user", message: { content: "do thing" }, timestamp: "2025-06-01T10:00:00Z" },
      { type: "assistant", message: { content: [{ type: "text", text: "done" }] }, timestamp: "2025-06-01T10:01:00Z" },
    ];
    const file = writeJsonl(dir, "s1.jsonl", records);

    const sync = parseSession(file, "/p", "p");
    const async_ = await parseSessionAsync(file, "/p", "p");

    // Same number of events, same types (async includes summary processing inline)
    expect(async_.length).toBe(sync.length);
    expect(async_.map((e) => e.type)).toEqual(sync.map((e) => e.type));
    expect(async_.map((e) => e.content)).toEqual(sync.map((e) => e.content));
  });
});

// ── parseAllSessions ───────────────────────────────────────────────────────

describe("parseAllSessions", () => {
  let dir: string;
  afterEach(() => dir && rmSync(dir, { recursive: true, force: true }));

  it("parses all jsonl files and sorts by timestamp", () => {
    dir = makeTmpDir();
    writeJsonl(dir, "a.jsonl", [
      { type: "user", message: { content: "second" }, timestamp: "2025-01-01T01:00:00Z" },
    ]);
    writeJsonl(dir, "b.jsonl", [
      { type: "user", message: { content: "first" }, timestamp: "2025-01-01T00:00:00Z" },
    ]);
    const events = parseAllSessions(dir);
    expect(events).toHaveLength(2);
    expect(events[0].content).toBe("first");
    expect(events[1].content).toBe("second");
  });

  it("respects since filter", () => {
    dir = makeTmpDir();
    // Create a file, then set its mtime to the past
    const p = writeJsonl(dir, "old.jsonl", [
      { type: "user", message: { content: "old" }, timestamp: "2020-01-01T00:00:00Z" },
    ]);
    // mtime is "now" so a future since should filter it out
    const events = parseAllSessions(dir, { since: new Date("2099-01-01") });
    expect(events).toHaveLength(0);
  });
});
