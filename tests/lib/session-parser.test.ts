import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { writeFileSync, mkdirSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { randomUUID } from "crypto";

// We test the public API; internal helpers are exercised through it.
import {
  findSessionFiles,
  parseSession,
  parseSessionAsync,
  parseAllSessions,
} from "../../src/lib/session-parser.js";

// ── Fixtures ───────────────────────────────────────────────────────────────

function tmpDir(): string {
  const dir = join(tmpdir(), `sp-test-${randomUUID()}`);
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
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("returns .jsonl files with sessionId", () => {
    dir = tmpDir();
    writeFileSync(join(dir, "abc-123.jsonl"), "");
    writeFileSync(join(dir, "readme.txt"), "");
    const files = findSessionFiles(dir);
    expect(files).toHaveLength(1);
    expect(files[0].sessionId).toBe("abc-123");
  });

  it("finds subagent jsonl files", () => {
    dir = tmpDir();
    const subDir = join(dir, "parent-session", "subagents");
    mkdirSync(subDir, { recursive: true });
    writeFileSync(join(subDir, "sub-1.jsonl"), "");
    const files = findSessionFiles(dir);
    expect(files).toHaveLength(1);
    expect(files[0].sessionId).toBe("sub-1");
  });

  it("returns empty for nonexistent dir", () => {
    expect(findSessionFiles("/tmp/does-not-exist-" + randomUUID())).toEqual([]);
  });
});

// ── parseSession ───────────────────────────────────────────────────────────

describe("parseSession", () => {
  let dir: string;
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("parses user prompts", () => {
    dir = tmpDir();
    const fp = writeJsonl(dir, "s.jsonl", [
      { type: "user", message: { content: "fix the bug" }, timestamp: "2025-01-01T00:00:00Z" },
    ]);
    const events = parseSession(fp, "/proj", "proj");
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("prompt");
    expect(events[0].content).toBe("fix the bug");
    expect(events[0].project).toBe("/proj");
  });

  it("parses assistant text responses", () => {
    dir = tmpDir();
    const fp = writeJsonl(dir, "s.jsonl", [
      { type: "assistant", message: { content: "done" }, timestamp: "2025-01-01T00:00:00Z" },
    ]);
    const events = parseSession(fp, "/p", "p");
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("assistant");
  });

  it("extracts tool_use blocks from assistant messages", () => {
    dir = tmpDir();
    const fp = writeJsonl(dir, "s.jsonl", [
      {
        type: "assistant",
        message: {
          content: [
            { type: "text", text: "I'll read the file" },
            { type: "tool_use", name: "Read", input: { path: "foo.ts" } },
          ],
        },
        timestamp: "2025-01-01T00:00:00Z",
      },
    ]);
    const events = parseSession(fp, "/p", "p");
    expect(events).toHaveLength(2);
    expect(events[0].type).toBe("assistant");
    expect(events[1].type).toBe("tool_call");
    expect(events[1].content).toContain("Read");
  });

  it("marks Task/dispatch_agent as sub_agent_spawn", () => {
    dir = tmpDir();
    const fp = writeJsonl(dir, "s.jsonl", [
      {
        type: "assistant",
        message: {
          content: [{ type: "tool_use", name: "Task", input: { prompt: "do stuff" } }],
        },
        timestamp: "2025-01-01T00:00:00Z",
      },
    ]);
    const events = parseSession(fp, "/p", "p");
    expect(events.some((e) => e.type === "sub_agent_spawn")).toBe(true);
  });

  it("detects corrections after assistant messages", () => {
    dir = tmpDir();
    const fp = writeJsonl(dir, "s.jsonl", [
      { type: "assistant", message: { content: "here you go" }, timestamp: "2025-01-01T00:00:00Z" },
      { type: "user", message: { content: "no, wrong file" }, timestamp: "2025-01-01T00:01:00Z" },
    ]);
    const events = parseSession(fp, "/p", "p");
    const correction = events.find((e) => e.type === "correction");
    expect(correction).toBeDefined();
    expect(correction!.content).toBe("no, wrong file");
  });

  it("does not mark first user message as correction", () => {
    dir = tmpDir();
    const fp = writeJsonl(dir, "s.jsonl", [
      { type: "user", message: { content: "no, wrong approach" }, timestamp: "2025-01-01T00:00:00Z" },
    ]);
    const events = parseSession(fp, "/p", "p");
    expect(events[0].type).toBe("prompt");
  });

  it("captures errors from tool_result", () => {
    dir = tmpDir();
    const fp = writeJsonl(dir, "s.jsonl", [
      { type: "tool_result", is_error: true, content: "ENOENT: file not found", timestamp: "2025-01-01T00:00:00Z" },
    ]);
    const events = parseSession(fp, "/p", "p");
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("error");
  });

  it("detects compaction events", () => {
    dir = tmpDir();
    const fp = writeJsonl(dir, "s.jsonl", [
      { type: "system", message: { content: "Context compacted automatically" }, timestamp: "2025-01-01T00:00:00Z" },
    ]);
    const events = parseSession(fp, "/p", "p");
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("compaction");
  });

  it("picks up branch from summary record", () => {
    dir = tmpDir();
    const fp = writeJsonl(dir, "s.jsonl", [
      { type: "summary", gitBranch: "feat/cool", sessionId: "sess-1" },
      { type: "user", message: { content: "hello" }, timestamp: "2025-01-01T00:00:00Z" },
    ]);
    const events = parseSession(fp, "/p", "p");
    expect(events[0].branch).toBe("feat/cool");
    expect(events[0].session_id).toBe("sess-1");
  });

  it("handles array content blocks", () => {
    dir = tmpDir();
    const fp = writeJsonl(dir, "s.jsonl", [
      {
        type: "user",
        message: {
          content: [
            { type: "text", text: "first part" },
            { type: "text", text: "second part" },
            { type: "image", source: {} },
          ],
        },
        timestamp: "2025-01-01T00:00:00Z",
      },
    ]);
    const events = parseSession(fp, "/p", "p");
    expect(events[0].content).toBe("first part\nsecond part");
  });

  it("skips malformed JSON lines gracefully", () => {
    dir = tmpDir();
    const fp = join(dir, "s.jsonl");
    writeFileSync(fp, '{"type":"user","message":{"content":"ok"},"timestamp":"2025-01-01T00:00:00Z"}\nNOT_JSON\n');
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const events = parseSession(fp, "/p", "p");
    expect(events).toHaveLength(1);
    expect(stderrSpy).toHaveBeenCalled();
    stderrSpy.mockRestore();
  });

  it("normalizes epoch timestamps", () => {
    dir = tmpDir();
    const fp = writeJsonl(dir, "s.jsonl", [
      { type: "user", message: { content: "hi" }, timestamp: 1704067200 },
    ]);
    const events = parseSession(fp, "/p", "p");
    expect(events[0].timestamp).toBe("2024-01-01T00:00:00.000Z");
  });

  it("truncates content_preview to 120 chars", () => {
    dir = tmpDir();
    const long = "a".repeat(200);
    const fp = writeJsonl(dir, "s.jsonl", [
      { type: "user", message: { content: long }, timestamp: "2025-01-01T00:00:00Z" },
    ]);
    const events = parseSession(fp, "/p", "p");
    expect(events[0].content_preview.length).toBeLessThanOrEqual(121); // 120 + "…"
  });
});

// ── parseSessionAsync ──────────────────────────────────────────────────────

describe("parseSessionAsync", () => {
  let dir: string;
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("produces same results as sync parser", async () => {
    dir = tmpDir();
    const records = [
      { type: "summary", gitBranch: "main", sessionId: "s1" },
      { type: "user", message: { content: "hello" }, timestamp: "2025-01-01T00:00:00Z" },
      { type: "assistant", message: { content: "hi" }, timestamp: "2025-01-01T00:01:00Z" },
      { type: "user", message: { content: "no wrong" }, timestamp: "2025-01-01T00:02:00Z" },
    ];
    const fp = writeJsonl(dir, "s.jsonl", records);
    const syncEvents = parseSession(fp, "/p", "p");
    const asyncEvents = await parseSessionAsync(fp, "/p", "p");
    // Same count and types (ids will differ)
    expect(asyncEvents.map((e) => e.type)).toEqual(syncEvents.map((e) => e.type));
    expect(asyncEvents.map((e) => e.content)).toEqual(syncEvents.map((e) => e.content));
  });
});

// ── parseAllSessions ───────────────────────────────────────────────────────

describe("parseAllSessions", () => {
  let dir: string;
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("parses all jsonl files in a project dir", () => {
    dir = tmpDir();
    writeJsonl(dir, "a.jsonl", [
      { type: "user", message: { content: "first" }, timestamp: "2025-01-01T00:00:00Z" },
    ]);
    writeJsonl(dir, "b.jsonl", [
      { type: "user", message: { content: "second" }, timestamp: "2025-01-02T00:00:00Z" },
    ]);
    const events = parseAllSessions(dir);
    expect(events).toHaveLength(2);
    // Should be sorted by timestamp
    expect(events[0].content).toBe("first");
    expect(events[1].content).toBe("second");
  });

  it("filters by since date", () => {
    dir = tmpDir();
    // Create files with different mtimes (both will have recent mtime, so we can't easily test mtime filtering in unit tests)
    // This just verifies the option is accepted without error
    writeJsonl(dir, "a.jsonl", [
      { type: "user", message: { content: "old" }, timestamp: "2020-01-01T00:00:00Z" },
    ]);
    const events = parseAllSessions(dir, { since: new Date("2099-01-01") });
    // File mtime is now, which is before 2099, so it should be filtered out
    expect(events).toHaveLength(0);
  });
});
