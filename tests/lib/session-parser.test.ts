/**
 * Tests for session-parser.ts — the core JSONL → TimelineEvent parser.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { writeFileSync, mkdirSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { randomUUID } from "crypto";
import { parseSession, findSessionFiles, type TimelineEvent } from "../../src/lib/session-parser.js";

// ── Helpers ────────────────────────────────────────────────────────────────

function makeTmpDir(): string {
  const dir = join(tmpdir(), `pf-test-${randomUUID()}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function writeJsonl(dir: string, filename: string, records: any[]): string {
  const path = join(dir, filename);
  writeFileSync(path, records.map((r) => JSON.stringify(r)).join("\n") + "\n");
  return path;
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe("parseSession", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("parses a user prompt into a prompt event", () => {
    const path = writeJsonl(tmpDir, "session.jsonl", [
      { type: "user", message: { content: "Hello world" }, timestamp: "2026-01-15T10:00:00Z" },
    ]);
    const events = parseSession(path, "/test/project", "project");
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("prompt");
    expect(events[0].content).toBe("Hello world");
    expect(events[0].timestamp).toBe("2026-01-15T10:00:00.000Z");
  });

  it("parses assistant text response", () => {
    const path = writeJsonl(tmpDir, "session.jsonl", [
      { type: "assistant", message: { content: "Here is the answer" }, timestamp: "2026-01-15T10:01:00Z" },
    ]);
    const events = parseSession(path, "/test/project", "project");
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("assistant");
    expect(events[0].content).toBe("Here is the answer");
  });

  it("parses assistant with content blocks (text + tool_use)", () => {
    const path = writeJsonl(tmpDir, "session.jsonl", [
      {
        type: "assistant",
        message: {
          content: [
            { type: "text", text: "Let me check that." },
            { type: "tool_use", name: "Read", input: { path: "/foo.ts" } },
          ],
        },
        timestamp: "2026-01-15T10:02:00Z",
      },
    ]);
    const events = parseSession(path, "/test/project", "project");
    expect(events).toHaveLength(2);
    expect(events[0].type).toBe("assistant");
    expect(events[0].content).toBe("Let me check that.");
    expect(events[1].type).toBe("tool_call");
    expect(events[1].content).toContain("Read");
  });

  it("detects sub_agent_spawn for Task tool", () => {
    const path = writeJsonl(tmpDir, "session.jsonl", [
      {
        type: "assistant",
        message: {
          content: [
            { type: "tool_use", name: "Task", input: { description: "refactor module" } },
          ],
        },
        timestamp: "2026-01-15T10:03:00Z",
      },
    ]);
    const events = parseSession(path, "/test/project", "project");
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("sub_agent_spawn");
  });

  it("detects dispatch_agent as sub_agent_spawn", () => {
    const path = writeJsonl(tmpDir, "session.jsonl", [
      {
        type: "assistant",
        message: {
          content: [
            { type: "tool_use", name: "dispatch_agent", input: {} },
          ],
        },
        timestamp: "2026-01-15T10:03:00Z",
      },
    ]);
    const events = parseSession(path, "/test/project", "project");
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("sub_agent_spawn");
  });

  it("detects corrections when user says 'no' after assistant", () => {
    const path = writeJsonl(tmpDir, "session.jsonl", [
      { type: "assistant", message: { content: "Done!" }, timestamp: "2026-01-15T10:04:00Z" },
      { type: "user", message: { content: "No, that's wrong" }, timestamp: "2026-01-15T10:05:00Z" },
    ]);
    const events = parseSession(path, "/test/project", "project");
    const correction = events.find((e) => e.type === "correction");
    expect(correction).toBeDefined();
    expect(correction!.content).toBe("No, that's wrong");
  });

  it("does NOT flag first user message as correction", () => {
    const path = writeJsonl(tmpDir, "session.jsonl", [
      { type: "user", message: { content: "No, start over" }, timestamp: "2026-01-15T10:00:00Z" },
    ]);
    const events = parseSession(path, "/test/project", "project");
    // First message has no prior assistant, so lastType is "" — not a correction
    expect(events[0].type).toBe("prompt");
  });

  it("parses tool_result errors", () => {
    const path = writeJsonl(tmpDir, "session.jsonl", [
      { type: "tool_result", is_error: true, content: "ENOENT: no such file", timestamp: "2026-01-15T10:06:00Z" },
    ]);
    const events = parseSession(path, "/test/project", "project");
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("error");
  });

  it("parses compaction system events", () => {
    const path = writeJsonl(tmpDir, "session.jsonl", [
      { type: "system", message: { content: "Context compacted to save tokens" }, timestamp: "2026-01-15T10:07:00Z" },
    ]);
    const events = parseSession(path, "/test/project", "project");
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("compaction");
  });

  it("extracts branch and sessionId from summary records", () => {
    const path = writeJsonl(tmpDir, "session.jsonl", [
      { type: "summary", gitBranch: "feat/cool", sessionId: "abc-123" },
      { type: "user", message: { content: "hi" }, timestamp: "2026-01-15T10:08:00Z" },
    ]);
    const events = parseSession(path, "/test/project", "project");
    expect(events).toHaveLength(1);
    expect(events[0].branch).toBe("feat/cool");
    expect(events[0].session_id).toBe("abc-123");
  });

  it("handles malformed JSON lines gracefully", () => {
    const path = join(tmpDir, "bad.jsonl");
    writeFileSync(path, '{"type":"user","message":{"content":"ok"},"timestamp":"2026-01-15T10:00:00Z"}\nNOT JSON\n');
    const events = parseSession(path, "/test/project", "project");
    expect(events).toHaveLength(1); // skips the bad line
  });

  it("handles empty files", () => {
    const path = join(tmpDir, "empty.jsonl");
    writeFileSync(path, "");
    const events = parseSession(path, "/test/project", "project");
    expect(events).toHaveLength(0);
  });

  it("normalizes epoch timestamps", () => {
    const path = writeJsonl(tmpDir, "session.jsonl", [
      { type: "user", message: { content: "test" }, timestamp: 1737000000 },
    ]);
    const events = parseSession(path, "/test/project", "project");
    expect(events[0].timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("handles content as array of text blocks", () => {
    const path = writeJsonl(tmpDir, "session.jsonl", [
      {
        type: "user",
        message: { content: [{ type: "text", text: "part1" }, { type: "text", text: "part2" }] },
        timestamp: "2026-01-15T10:00:00Z",
      },
    ]);
    const events = parseSession(path, "/test/project", "project");
    expect(events[0].content).toBe("part1\npart2");
  });

  it("populates all required fields on events", () => {
    const path = writeJsonl(tmpDir, "session.jsonl", [
      { type: "user", message: { content: "hello" }, timestamp: "2026-01-15T10:00:00Z" },
    ]);
    const events = parseSession(path, "/test/project", "project");
    const e = events[0];
    expect(e.id).toBeTruthy();
    expect(e.content_preview).toBeTruthy();
    expect(e.project).toBe("/test/project");
    expect(e.project_name).toBe("project");
    expect(e.source_file).toBe(path);
    expect(e.source_line).toBeGreaterThan(0);
    expect(e.metadata).toBeTruthy();
  });
});

describe("findSessionFiles", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("finds .jsonl files in the directory", () => {
    writeFileSync(join(tmpDir, "abc.jsonl"), "{}");
    writeFileSync(join(tmpDir, "readme.md"), "hi");
    const files = findSessionFiles(tmpDir);
    expect(files).toHaveLength(1);
    expect(files[0].sessionId).toBe("abc");
  });

  it("finds subagent files", () => {
    const subDir = join(tmpDir, "main-session", "subagents");
    mkdirSync(subDir, { recursive: true });
    writeFileSync(join(subDir, "sub-1.jsonl"), "{}");
    const files = findSessionFiles(tmpDir);
    expect(files).toHaveLength(1);
    expect(files[0].sessionId).toBe("sub-1");
  });

  it("returns empty for nonexistent directory", () => {
    const files = findSessionFiles("/nonexistent/path/xyz");
    expect(files).toHaveLength(0);
  });
});
