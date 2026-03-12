/**
 * Tests for session-parser.ts — JSONL session file parsing into timeline events.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { writeFileSync, mkdirSync, rmSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { randomUUID } from "crypto";
import { parseSession, findSessionFiles } from "../../src/lib/session-parser.js";

// ── Test helpers ───────────────────────────────────────────────────────────

function tmpDir(): string {
  const dir = join(tmpdir(), `preflight-test-${randomUUID().slice(0, 8)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function writeJsonl(dir: string, filename: string, records: any[]): string {
  const path = join(dir, filename);
  writeFileSync(path, records.map((r) => JSON.stringify(r)).join("\n") + "\n");
  return path;
}

function userMessage(text: string, ts?: string): any {
  return {
    type: "user",
    timestamp: ts ?? new Date().toISOString(),
    message: { content: [{ type: "text", text }] },
  };
}

function assistantMessage(text: string, ts?: string, toolUses?: any[]): any {
  const content: any[] = [{ type: "text", text }];
  if (toolUses) content.push(...toolUses);
  return {
    type: "assistant",
    timestamp: ts ?? new Date().toISOString(),
    message: { content },
    model: "claude-3-opus",
  };
}

function toolResult(content: string, isError = false): any {
  return {
    type: "tool_result",
    timestamp: new Date().toISOString(),
    content,
    is_error: isError,
  };
}

function summaryRecord(sessionId: string, branch?: string): any {
  return {
    type: "summary",
    sessionId,
    gitBranch: branch ?? "main",
  };
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe("parseSession", () => {
  let dir: string;

  beforeEach(() => {
    dir = tmpDir();
  });

  afterEach(() => {
    if (existsSync(dir)) rmSync(dir, { recursive: true });
  });

  it("parses a simple user prompt", () => {
    const path = writeJsonl(dir, "session.jsonl", [
      userMessage("Fix the login bug in src/auth.ts"),
    ]);
    const events = parseSession(path, "/project", "project");
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("prompt");
    expect(events[0].content).toContain("Fix the login bug");
    expect(events[0].project_name).toBe("project");
  });

  it("parses assistant responses", () => {
    const path = writeJsonl(dir, "session.jsonl", [
      userMessage("Hello"),
      assistantMessage("I'll help you with that."),
    ]);
    const events = parseSession(path, "/project", "project");
    expect(events).toHaveLength(2);
    expect(events[0].type).toBe("prompt");
    expect(events[1].type).toBe("assistant");
    expect(events[1].content).toBe("I'll help you with that.");
  });

  it("detects corrections after assistant responses", () => {
    const path = writeJsonl(dir, "session.jsonl", [
      userMessage("Add a test"),
      assistantMessage("Done!"),
      userMessage("No, wrong file"),
    ]);
    const events = parseSession(path, "/project", "project");
    expect(events).toHaveLength(3);
    expect(events[2].type).toBe("correction");
  });

  it("does not flag first message as correction", () => {
    const path = writeJsonl(dir, "session.jsonl", [
      userMessage("Actually, let's start with the tests"),
    ]);
    const events = parseSession(path, "/project", "project");
    // First message can't be a correction since there's no prior assistant message
    // (lastType starts as "")
    expect(events[0].type).toBe("prompt");
  });

  it("extracts tool_call events from assistant messages", () => {
    const path = writeJsonl(dir, "session.jsonl", [
      assistantMessage("Let me read the file.", undefined, [
        { type: "tool_use", name: "Read", input: { file_path: "src/main.ts" } },
      ]),
    ]);
    const events = parseSession(path, "/project", "project");
    expect(events).toHaveLength(2); // assistant + tool_call
    const toolEvent = events.find((e) => e.type === "tool_call");
    expect(toolEvent).toBeDefined();
    expect(toolEvent!.content).toContain("Read");
  });

  it("detects sub_agent_spawn from Task tool_use", () => {
    const path = writeJsonl(dir, "session.jsonl", [
      assistantMessage("Spawning sub-agent.", undefined, [
        { type: "tool_use", name: "Task", input: { description: "Run lint" } },
      ]),
    ]);
    const events = parseSession(path, "/project", "project");
    const spawn = events.find((e) => e.type === "sub_agent_spawn");
    expect(spawn).toBeDefined();
  });

  it("detects sub_agent_spawn from dispatch_agent tool_use", () => {
    const path = writeJsonl(dir, "session.jsonl", [
      assistantMessage("Dispatching.", undefined, [
        { type: "tool_use", name: "dispatch_agent", input: {} },
      ]),
    ]);
    const events = parseSession(path, "/project", "project");
    const spawn = events.find((e) => e.type === "sub_agent_spawn");
    expect(spawn).toBeDefined();
  });

  it("detects error events from tool_result with is_error", () => {
    const path = writeJsonl(dir, "session.jsonl", [
      toolResult("Command failed: ENOENT", true),
    ]);
    const events = parseSession(path, "/project", "project");
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("error");
  });

  it("detects compaction events from system messages", () => {
    const path = writeJsonl(dir, "session.jsonl", [
      {
        type: "system",
        timestamp: new Date().toISOString(),
        message: { content: "Context was compacted to reduce token usage" },
      },
    ]);
    const events = parseSession(path, "/project", "project");
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("compaction");
  });

  it("reads branch and sessionId from summary records", () => {
    const path = writeJsonl(dir, "session.jsonl", [
      summaryRecord("abc-123", "feature/auth"),
      userMessage("Hello"),
    ]);
    const events = parseSession(path, "/project", "project");
    expect(events).toHaveLength(1);
    expect(events[0].branch).toBe("feature/auth");
    expect(events[0].session_id).toBe("abc-123");
  });

  it("skips malformed JSON lines gracefully", () => {
    const path = join(dir, "bad.jsonl");
    writeFileSync(path, '{"type":"user","message":{"content":"ok"}}\nNOT_JSON\n{"type":"user","message":{"content":"hi"}}\n');
    const events = parseSession(path, "/project", "project");
    // Should parse 2 user messages, skip the bad line
    expect(events).toHaveLength(2);
  });

  it("handles empty files", () => {
    const path = join(dir, "empty.jsonl");
    writeFileSync(path, "");
    const events = parseSession(path, "/project", "project");
    expect(events).toHaveLength(0);
  });

  it("handles string content in user messages", () => {
    const path = writeJsonl(dir, "session.jsonl", [
      {
        type: "user",
        timestamp: new Date().toISOString(),
        message: { content: "plain string content" },
      },
    ]);
    const events = parseSession(path, "/project", "project");
    expect(events).toHaveLength(1);
    expect(events[0].content).toBe("plain string content");
  });

  it("normalizes epoch timestamps", () => {
    const epochSec = Math.floor(Date.now() / 1000);
    const path = writeJsonl(dir, "session.jsonl", [
      {
        type: "user",
        timestamp: epochSec,
        message: { content: "test" },
      },
    ]);
    const events = parseSession(path, "/project", "project");
    expect(events[0].timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("generates content_preview truncated to 120 chars", () => {
    const longText = "A".repeat(200);
    const path = writeJsonl(dir, "session.jsonl", [userMessage(longText)]);
    const events = parseSession(path, "/project", "project");
    expect(events[0].content_preview.length).toBeLessThanOrEqual(121); // 120 + "…"
    expect(events[0].content_preview).toContain("…");
  });

  it("assigns unique IDs to each event", () => {
    const path = writeJsonl(dir, "session.jsonl", [
      userMessage("one"),
      userMessage("two"),
      userMessage("three"),
    ]);
    const events = parseSession(path, "/project", "project");
    const ids = events.map((e) => e.id);
    expect(new Set(ids).size).toBe(3);
  });
});

describe("findSessionFiles", () => {
  let dir: string;

  beforeEach(() => {
    dir = tmpDir();
  });

  afterEach(() => {
    if (existsSync(dir)) rmSync(dir, { recursive: true });
  });

  it("finds .jsonl files in the directory", () => {
    writeFileSync(join(dir, "abc.jsonl"), "{}");
    writeFileSync(join(dir, "def.jsonl"), "{}");
    writeFileSync(join(dir, "readme.md"), "not a session");
    const files = findSessionFiles(dir);
    expect(files).toHaveLength(2);
    expect(files.map((f) => f.sessionId).sort()).toEqual(["abc", "def"]);
  });

  it("finds subagent files", () => {
    const subDir = join(dir, "parent-session", "subagents");
    mkdirSync(subDir, { recursive: true });
    writeFileSync(join(subDir, "sub-123.jsonl"), "{}");
    const files = findSessionFiles(dir);
    expect(files).toHaveLength(1);
    expect(files[0].sessionId).toBe("sub-123");
  });

  it("returns empty for non-existent directory", () => {
    const files = findSessionFiles("/tmp/does-not-exist-" + randomUUID());
    expect(files).toHaveLength(0);
  });
});
