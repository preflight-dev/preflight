/**
 * Tests for session-parser.ts — JSONL session parsing, event extraction,
 * correction detection, and timestamp normalization.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { writeFileSync, mkdirSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { randomUUID } from "crypto";
import { parseSession, findSessionFiles, parseSessionAsync } from "../../src/lib/session-parser.js";

// ── Test Fixtures ──────────────────────────────────────────────────────────

function tmpDir(): string {
  const dir = join(tmpdir(), `preflight-test-${randomUUID()}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function writeJsonl(dir: string, name: string, records: any[]): string {
  const p = join(dir, name);
  writeFileSync(p, records.map((r) => JSON.stringify(r)).join("\n") + "\n");
  return p;
}

const USER_MSG = (text: string) => ({
  type: "user",
  timestamp: "2025-01-15T10:00:00Z",
  message: { content: text },
});

const ASSISTANT_MSG = (text: string) => ({
  type: "assistant",
  timestamp: "2025-01-15T10:00:05Z",
  message: { content: [{ type: "text", text }] },
});

const TOOL_CALL_MSG = (toolName: string, input: any, text?: string) => ({
  type: "assistant",
  timestamp: "2025-01-15T10:00:10Z",
  message: {
    content: [
      ...(text ? [{ type: "text", text }] : []),
      { type: "tool_use", name: toolName, input },
    ],
  },
});

const TOOL_RESULT = (content: string, isError = false) => ({
  type: "tool_result",
  timestamp: "2025-01-15T10:00:15Z",
  content,
  is_error: isError,
  tool_use_id: "tu_123",
});

const SUMMARY = (branch?: string, sessionId?: string) => ({
  type: "summary",
  ...(branch && { gitBranch: branch }),
  ...(sessionId && { sessionId }),
});

const SYSTEM_COMPACT = () => ({
  type: "system",
  timestamp: "2025-01-15T10:05:00Z",
  subtype: "compaction",
  content: "context compacted",
});

// ── Tests ──────────────────────────────────────────────────────────────────

describe("parseSession", () => {
  let dir: string;

  beforeEach(() => {
    dir = tmpDir();
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("parses user prompts into prompt events", () => {
    const file = writeJsonl(dir, "test.jsonl", [
      USER_MSG("fix the auth bug in src/auth.ts"),
    ]);
    const events = parseSession(file, "/test", "test");
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("prompt");
    expect(events[0].content).toBe("fix the auth bug in src/auth.ts");
    expect(events[0].project).toBe("/test");
    expect(events[0].project_name).toBe("test");
  });

  it("parses assistant text responses", () => {
    const file = writeJsonl(dir, "test.jsonl", [
      ASSISTANT_MSG("I'll fix that for you"),
    ]);
    const events = parseSession(file, "/test", "test");
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("assistant");
    expect(events[0].content).toBe("I'll fix that for you");
  });

  it("extracts tool calls as tool_call events", () => {
    const file = writeJsonl(dir, "test.jsonl", [
      TOOL_CALL_MSG("Read", { file_path: "src/auth.ts" }),
    ]);
    const events = parseSession(file, "/test", "test");
    const toolEvents = events.filter((e) => e.type === "tool_call");
    expect(toolEvents).toHaveLength(1);
    expect(toolEvents[0].content).toContain("Read");
  });

  it("detects sub_agent_spawn for Task tool calls", () => {
    const file = writeJsonl(dir, "test.jsonl", [
      TOOL_CALL_MSG("Task", { description: "fix auth" }),
    ]);
    const events = parseSession(file, "/test", "test");
    const spawns = events.filter((e) => e.type === "sub_agent_spawn");
    expect(spawns).toHaveLength(1);
  });

  it("detects sub_agent_spawn for dispatch_agent tool calls", () => {
    const file = writeJsonl(dir, "test.jsonl", [
      TOOL_CALL_MSG("dispatch_agent", { task: "review PR" }),
    ]);
    const events = parseSession(file, "/test", "test");
    const spawns = events.filter((e) => e.type === "sub_agent_spawn");
    expect(spawns).toHaveLength(1);
  });

  it("detects corrections after assistant messages", () => {
    const file = writeJsonl(dir, "test.jsonl", [
      ASSISTANT_MSG("Here's the fix"),
      USER_MSG("no, that's wrong"),
    ]);
    const events = parseSession(file, "/test", "test");
    const corrections = events.filter((e) => e.type === "correction");
    expect(corrections).toHaveLength(1);
    expect(corrections[0].content).toBe("no, that's wrong");
  });

  it("does not flag first user message as correction", () => {
    const file = writeJsonl(dir, "test.jsonl", [
      USER_MSG("no, fix the other file"),
    ]);
    const events = parseSession(file, "/test", "test");
    // No preceding assistant → should be a prompt, not correction
    expect(events[0].type).toBe("prompt");
  });

  it("detects error tool results", () => {
    const file = writeJsonl(dir, "test.jsonl", [
      TOOL_RESULT("ENOENT: no such file", true),
    ]);
    const events = parseSession(file, "/test", "test");
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("error");
  });

  it("detects compaction events", () => {
    const file = writeJsonl(dir, "test.jsonl", [SYSTEM_COMPACT()]);
    const events = parseSession(file, "/test", "test");
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("compaction");
  });

  it("picks up branch and sessionId from summary records", () => {
    const file = writeJsonl(dir, "test.jsonl", [
      SUMMARY("feature/auth", "sess-abc"),
      USER_MSG("hello"),
    ]);
    const events = parseSession(file, "/test", "test");
    expect(events).toHaveLength(1);
    expect(events[0].branch).toBe("feature/auth");
    expect(events[0].session_id).toBe("sess-abc");
  });

  it("handles malformed JSON lines gracefully", () => {
    const p = join(dir, "bad.jsonl");
    writeFileSync(p, '{"type":"user","message":{"content":"ok"},"timestamp":"2025-01-15T10:00:00Z"}\nNOT_JSON\n');
    const events = parseSession(p, "/test", "test");
    expect(events).toHaveLength(1); // skips bad line
  });

  it("handles empty file", () => {
    const p = join(dir, "empty.jsonl");
    writeFileSync(p, "");
    const events = parseSession(p, "/test", "test");
    expect(events).toHaveLength(0);
  });

  it("normalizes epoch seconds timestamps", () => {
    const file = writeJsonl(dir, "test.jsonl", [
      { type: "user", timestamp: 1705312800, message: { content: "hello" } },
    ]);
    const events = parseSession(file, "/test", "test");
    expect(events[0].timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("normalizes epoch milliseconds timestamps", () => {
    const file = writeJsonl(dir, "test.jsonl", [
      { type: "user", timestamp: 1705312800000, message: { content: "hi" } },
    ]);
    const events = parseSession(file, "/test", "test");
    expect(events[0].timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("generates content_preview truncated to ~120 chars", () => {
    const longText = "A".repeat(200);
    const file = writeJsonl(dir, "test.jsonl", [USER_MSG(longText)]);
    const events = parseSession(file, "/test", "test");
    expect(events[0].content_preview.length).toBeLessThanOrEqual(121); // 120 + "…"
    expect(events[0].content_preview).toContain("…");
  });
});

describe("parseSessionAsync", () => {
  let dir: string;

  beforeEach(() => {
    dir = tmpDir();
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("produces same events as sync parser", async () => {
    const file = writeJsonl(dir, "test.jsonl", [
      SUMMARY("main"),
      USER_MSG("do the thing"),
      ASSISTANT_MSG("done"),
      USER_MSG("wrong, undo that"),
    ]);
    const syncEvents = parseSession(file, "/p", "p");
    const asyncEvents = await parseSessionAsync(file, "/p", "p");
    expect(asyncEvents.length).toBe(syncEvents.length);
    expect(asyncEvents.map((e) => e.type)).toEqual(syncEvents.map((e) => e.type));
  });
});

describe("findSessionFiles", () => {
  let dir: string;

  beforeEach(() => {
    dir = tmpDir();
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("finds .jsonl files in root directory", () => {
    writeFileSync(join(dir, "session1.jsonl"), "{}");
    writeFileSync(join(dir, "session2.jsonl"), "{}");
    writeFileSync(join(dir, "readme.txt"), "not a session");
    const files = findSessionFiles(dir);
    expect(files).toHaveLength(2);
    expect(files.every((f) => f.path.endsWith(".jsonl"))).toBe(true);
  });

  it("finds subagent session files", () => {
    const subDir = join(dir, "parent-session", "subagents");
    mkdirSync(subDir, { recursive: true });
    writeFileSync(join(subDir, "sub1.jsonl"), "{}");
    const files = findSessionFiles(dir);
    expect(files).toHaveLength(1);
    expect(files[0].sessionId).toBe("sub1");
  });

  it("returns empty for non-existent directory", () => {
    const files = findSessionFiles("/nonexistent/path");
    expect(files).toHaveLength(0);
  });
});
