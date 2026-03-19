import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// We test the internal pure helpers by importing the module and exercising
// the public API with controlled JSONL data written to temp files.
import { writeFileSync, mkdirSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
  findSessionFiles,
  parseSession,
  parseSessionAsync,
  parseAllSessions,
} from "../../src/lib/session-parser.js";

// ── Fixtures ───────────────────────────────────────────────────────────────

function tmpDir(): string {
  const dir = join(tmpdir(), `preflight-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function jsonl(...records: any[]): string {
  return records.map((r) => JSON.stringify(r)).join("\n") + "\n";
}

const summaryRecord = {
  type: "summary",
  sessionId: "sess-123",
  gitBranch: "main",
};

const userPrompt = {
  type: "user",
  timestamp: "2025-06-01T10:00:00Z",
  message: { content: "refactor the auth module" },
};

const assistantReply = {
  type: "assistant",
  timestamp: "2025-06-01T10:00:05Z",
  model: "claude-sonnet-4-20250514",
  message: {
    content: [
      { type: "text", text: "Sure, I'll refactor the auth module." },
      { type: "tool_use", name: "Edit", input: { file: "auth.ts" } },
    ],
  },
};

const correctionPrompt = {
  type: "user",
  timestamp: "2025-06-01T10:00:10Z",
  message: { content: "no, I meant the login flow" },
};

const toolResultError = {
  type: "tool_result",
  timestamp: "2025-06-01T10:00:12Z",
  is_error: true,
  content: "stderr: file not found",
  tool_use_id: "tu-1",
};

const compactionRecord = {
  type: "system",
  timestamp: "2025-06-01T10:01:00Z",
  subtype: "compaction",
  message: { content: "context compacted" },
};

const subAgentCall = {
  type: "assistant",
  timestamp: "2025-06-01T10:00:20Z",
  message: {
    content: [
      { type: "tool_use", name: "Task", input: { task: "run tests" } },
    ],
  },
};

// ── Tests ──────────────────────────────────────────────────────────────────

describe("findSessionFiles", () => {
  it("returns empty for non-existent dir", () => {
    expect(findSessionFiles("/tmp/does-not-exist-xyz")).toEqual([]);
  });

  it("discovers .jsonl files and subagent files", () => {
    const dir = tmpDir();
    writeFileSync(join(dir, "session-a.jsonl"), "{}");
    // Create subagent dir
    const subDir = join(dir, "session-a", "subagents");
    mkdirSync(subDir, { recursive: true });
    writeFileSync(join(subDir, "sub-1.jsonl"), "{}");

    const files = findSessionFiles(dir);
    expect(files.length).toBe(2);
    expect(files.map((f) => f.sessionId).sort()).toEqual(["session-a", "sub-1"]);

    rmSync(dir, { recursive: true, force: true });
  });
});

describe("parseSession", () => {
  it("parses user prompts into prompt events", () => {
    const dir = tmpDir();
    const file = join(dir, "s1.jsonl");
    writeFileSync(file, jsonl(summaryRecord, userPrompt));

    const events = parseSession(file, "/test", "test");
    expect(events.length).toBe(1);
    expect(events[0].type).toBe("prompt");
    expect(events[0].content).toBe("refactor the auth module");
    expect(events[0].session_id).toBe("sess-123");
    expect(events[0].branch).toBe("main");

    rmSync(dir, { recursive: true, force: true });
  });

  it("parses assistant text + tool_use into multiple events", () => {
    const dir = tmpDir();
    const file = join(dir, "s2.jsonl");
    writeFileSync(file, jsonl(summaryRecord, userPrompt, assistantReply));

    const events = parseSession(file, "/test", "test");
    // prompt + assistant text + tool_call
    expect(events.length).toBe(3);
    expect(events[1].type).toBe("assistant");
    expect(events[2].type).toBe("tool_call");
    expect(events[2].content).toContain("Edit");

    rmSync(dir, { recursive: true, force: true });
  });

  it("detects corrections after assistant replies", () => {
    const dir = tmpDir();
    const file = join(dir, "s3.jsonl");
    writeFileSync(file, jsonl(summaryRecord, userPrompt, assistantReply, correctionPrompt));

    const events = parseSession(file, "/test", "test");
    const correction = events.find((e) => e.type === "correction");
    expect(correction).toBeDefined();
    expect(correction!.content).toContain("login flow");

    rmSync(dir, { recursive: true, force: true });
  });

  it("parses tool_result errors", () => {
    const dir = tmpDir();
    const file = join(dir, "s4.jsonl");
    writeFileSync(file, jsonl(summaryRecord, toolResultError));

    const events = parseSession(file, "/test", "test");
    expect(events.length).toBe(1);
    expect(events[0].type).toBe("error");
    expect(events[0].content).toContain("file not found");

    rmSync(dir, { recursive: true, force: true });
  });

  it("parses compaction events", () => {
    const dir = tmpDir();
    const file = join(dir, "s5.jsonl");
    writeFileSync(file, jsonl(summaryRecord, compactionRecord));

    const events = parseSession(file, "/test", "test");
    expect(events.length).toBe(1);
    expect(events[0].type).toBe("compaction");

    rmSync(dir, { recursive: true, force: true });
  });

  it("detects sub_agent_spawn for Task tool", () => {
    const dir = tmpDir();
    const file = join(dir, "s6.jsonl");
    writeFileSync(file, jsonl(summaryRecord, subAgentCall));

    const events = parseSession(file, "/test", "test");
    expect(events.length).toBe(1);
    expect(events[0].type).toBe("sub_agent_spawn");

    rmSync(dir, { recursive: true, force: true });
  });

  it("handles malformed JSON lines gracefully", () => {
    const dir = tmpDir();
    const file = join(dir, "s7.jsonl");
    writeFileSync(file, "not json\n" + JSON.stringify(userPrompt) + "\n");

    // Should not throw, should skip bad line
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const events = parseSession(file, "/test", "test");
    expect(events.length).toBe(1);
    expect(stderrSpy).toHaveBeenCalled();
    stderrSpy.mockRestore();

    rmSync(dir, { recursive: true, force: true });
  });

  it("handles empty content gracefully", () => {
    const dir = tmpDir();
    const file = join(dir, "s8.jsonl");
    writeFileSync(file, jsonl({ type: "user", message: { content: "" } }));

    const events = parseSession(file, "/test", "test");
    expect(events.length).toBe(0);

    rmSync(dir, { recursive: true, force: true });
  });

  it("normalizes epoch timestamps", () => {
    const dir = tmpDir();
    const file = join(dir, "s9.jsonl");
    const record = { type: "user", timestamp: 1717236000, message: { content: "hello" } };
    writeFileSync(file, jsonl(record));

    const events = parseSession(file, "/test", "test");
    expect(events[0].timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    rmSync(dir, { recursive: true, force: true });
  });

  it("generates unique IDs and content_preview", () => {
    const dir = tmpDir();
    const file = join(dir, "s10.jsonl");
    writeFileSync(file, jsonl(userPrompt, { ...userPrompt, timestamp: "2025-06-01T10:01:00Z" }));

    const events = parseSession(file, "/test", "test");
    expect(events.length).toBe(2);
    expect(events[0].id).not.toBe(events[1].id);
    expect(events[0].content_preview).toBeTruthy();

    rmSync(dir, { recursive: true, force: true });
  });
});

describe("parseSessionAsync", () => {
  it("produces same events as sync parser", async () => {
    const dir = tmpDir();
    const file = join(dir, "async.jsonl");
    writeFileSync(file, jsonl(summaryRecord, userPrompt, assistantReply, correctionPrompt));

    const syncEvents = parseSession(file, "/test", "test");
    const asyncEvents = await parseSessionAsync(file, "/test", "test");

    // Same count and types (IDs differ since they're random UUIDs)
    expect(asyncEvents.length).toBe(syncEvents.length);
    expect(asyncEvents.map((e) => e.type)).toEqual(syncEvents.map((e) => e.type));

    rmSync(dir, { recursive: true, force: true });
  });
});

describe("parseAllSessions", () => {
  it("parses all .jsonl files in a directory", () => {
    const dir = tmpDir();
    writeFileSync(join(dir, "a.jsonl"), jsonl(userPrompt));
    writeFileSync(join(dir, "b.jsonl"), jsonl(userPrompt));

    const events = parseAllSessions(dir);
    expect(events.length).toBe(2);

    rmSync(dir, { recursive: true, force: true });
  });

  it("filters by since date", () => {
    const dir = tmpDir();
    writeFileSync(join(dir, "old.jsonl"), jsonl(userPrompt));

    // Filter with a future date → should skip
    const events = parseAllSessions(dir, { since: new Date("2099-01-01") });
    expect(events.length).toBe(0);

    rmSync(dir, { recursive: true, force: true });
  });

  it("returns empty for non-existent dir", () => {
    // inferProject + findSessionFiles handle missing dirs
    const dir = tmpDir();
    rmSync(dir, { recursive: true, force: true });
    // parseAllSessions calls findSessionFiles which returns [] for missing dir
    // But it also calls inferProject on the dir basename — should not throw
    const events = parseAllSessions(dir);
    expect(events.length).toBe(0);
  });
});
