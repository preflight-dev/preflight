/**
 * Tests for session-parser.ts
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { writeFileSync, mkdirSync, rmSync, statSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { randomUUID } from "crypto";
import {
  parseSession,
  parseSessionAsync,
  findSessionFiles,
  parseAllSessions,
} from "../../src/lib/session-parser.js";

// ── Helpers ────────────────────────────────────────────────────────────────

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

// ── Fixtures ───────────────────────────────────────────────────────────────

const SUMMARY_RECORD = {
  type: "summary",
  sessionId: "sess-001",
  gitBranch: "main",
};

const USER_PROMPT = {
  type: "user",
  timestamp: "2026-03-16T10:00:00Z",
  message: { content: "Fix the login bug" },
};

const ASSISTANT_TEXT = {
  type: "assistant",
  timestamp: "2026-03-16T10:00:05Z",
  model: "claude-3.5-sonnet",
  message: { content: [{ type: "text", text: "I'll fix the login bug now." }] },
};

const ASSISTANT_WITH_TOOL = {
  type: "assistant",
  timestamp: "2026-03-16T10:00:10Z",
  message: {
    content: [
      { type: "text", text: "Let me read the file." },
      { type: "tool_use", name: "Read", input: { path: "src/login.ts" } },
    ],
  },
};

const ASSISTANT_WITH_SUBAGENT = {
  type: "assistant",
  timestamp: "2026-03-16T10:00:15Z",
  message: {
    content: [
      { type: "tool_use", name: "Task", input: { task: "refactor auth" } },
    ],
  },
};

const TOOL_RESULT_OK = {
  type: "tool_result",
  timestamp: "2026-03-16T10:00:12Z",
  tool_use_id: "tu-1",
  content: "file contents here",
};

const TOOL_RESULT_ERROR = {
  type: "tool_result",
  timestamp: "2026-03-16T10:00:12Z",
  tool_use_id: "tu-2",
  is_error: true,
  content: "ENOENT: no such file",
};

const COMPACTION = {
  type: "system",
  timestamp: "2026-03-16T12:00:00Z",
  subtype: "compaction",
  message: { content: "Context compacted" },
};

const CORRECTION_PROMPT = {
  type: "user",
  timestamp: "2026-03-16T10:00:20Z",
  message: { content: "No, I meant the signup page, not login" },
};

// ── Tests ──────────────────────────────────────────────────────────────────

describe("session-parser", () => {
  let dir: string;

  beforeEach(() => {
    dir = tmpDir();
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  describe("parseSession (sync)", () => {
    it("parses user prompts", () => {
      const f = writeJsonl(dir, "test.jsonl", [USER_PROMPT]);
      const events = parseSession(f, "/test/project", "project");
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe("prompt");
      expect(events[0].content).toBe("Fix the login bug");
      expect(events[0].timestamp).toBe("2026-03-16T10:00:00.000Z");
    });

    it("parses assistant text responses", () => {
      const f = writeJsonl(dir, "test.jsonl", [ASSISTANT_TEXT]);
      const events = parseSession(f, "/test", "test");
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe("assistant");
      expect(events[0].content).toContain("fix the login bug");
      const meta = JSON.parse(events[0].metadata);
      expect(meta.model).toBe("claude-3.5-sonnet");
    });

    it("extracts tool_call events from assistant messages", () => {
      const f = writeJsonl(dir, "test.jsonl", [ASSISTANT_WITH_TOOL]);
      const events = parseSession(f, "/test", "test");
      const toolEvents = events.filter((e) => e.type === "tool_call");
      expect(toolEvents).toHaveLength(1);
      expect(toolEvents[0].content).toContain("Read");
    });

    it("identifies sub_agent_spawn from Task tool", () => {
      const f = writeJsonl(dir, "test.jsonl", [ASSISTANT_WITH_SUBAGENT]);
      const events = parseSession(f, "/test", "test");
      const spawns = events.filter((e) => e.type === "sub_agent_spawn");
      expect(spawns).toHaveLength(1);
      expect(spawns[0].content).toContain("Task");
    });

    it("captures error tool results", () => {
      const f = writeJsonl(dir, "test.jsonl", [TOOL_RESULT_ERROR]);
      const events = parseSession(f, "/test", "test");
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe("error");
      expect(events[0].content).toContain("ENOENT");
    });

    it("ignores successful tool results", () => {
      const f = writeJsonl(dir, "test.jsonl", [TOOL_RESULT_OK]);
      const events = parseSession(f, "/test", "test");
      expect(events).toHaveLength(0);
    });

    it("detects compaction events", () => {
      const f = writeJsonl(dir, "test.jsonl", [COMPACTION]);
      const events = parseSession(f, "/test", "test");
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe("compaction");
    });

    it("detects corrections after assistant messages", () => {
      const f = writeJsonl(dir, "test.jsonl", [
        USER_PROMPT,
        ASSISTANT_TEXT,
        CORRECTION_PROMPT,
      ]);
      const events = parseSession(f, "/test", "test");
      const corrections = events.filter((e) => e.type === "correction");
      expect(corrections).toHaveLength(1);
      expect(corrections[0].content).toContain("signup page");
    });

    it("reads branch and sessionId from summary records", () => {
      const f = writeJsonl(dir, "test.jsonl", [SUMMARY_RECORD, USER_PROMPT]);
      const events = parseSession(f, "/test", "test");
      expect(events).toHaveLength(1);
      expect(events[0].branch).toBe("main");
      expect(events[0].session_id).toBe("sess-001");
    });

    it("handles empty files", () => {
      const f = writeJsonl(dir, "test.jsonl", []);
      writeFileSync(f, "");
      const events = parseSession(f, "/test", "test");
      expect(events).toHaveLength(0);
    });

    it("skips malformed JSON lines gracefully", () => {
      const f = join(dir, "bad.jsonl");
      writeFileSync(f, '{"type":"user","timestamp":"2026-01-01T00:00:00Z","message":{"content":"hi"}}\n{bad json\n');
      const events = parseSession(f, "/test", "test");
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe("prompt");
    });

    it("normalizes epoch timestamps", () => {
      const record = {
        type: "user",
        timestamp: 1742122800, // epoch seconds
        message: { content: "test epoch" },
      };
      const f = writeJsonl(dir, "test.jsonl", [record]);
      const events = parseSession(f, "/test", "test");
      expect(events).toHaveLength(1);
      // Should be a valid ISO string
      expect(events[0].timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it("handles string content (not array) in messages", () => {
      const record = {
        type: "user",
        timestamp: "2026-03-16T10:00:00Z",
        message: { content: "plain string content" },
      };
      const f = writeJsonl(dir, "test.jsonl", [record]);
      const events = parseSession(f, "/test", "test");
      expect(events).toHaveLength(1);
      expect(events[0].content).toBe("plain string content");
    });

    it("handles user message with no content gracefully", () => {
      const record = {
        type: "user",
        timestamp: "2026-03-16T10:00:00Z",
        message: { content: "" },
      };
      const f = writeJsonl(dir, "test.jsonl", [record]);
      const events = parseSession(f, "/test", "test");
      expect(events).toHaveLength(0); // empty content should be skipped
    });
  });

  describe("parseSessionAsync", () => {
    it("produces same results as sync parser", async () => {
      const records = [SUMMARY_RECORD, USER_PROMPT, ASSISTANT_TEXT, ASSISTANT_WITH_TOOL, TOOL_RESULT_ERROR, COMPACTION];
      const f = writeJsonl(dir, "test.jsonl", records);
      const syncEvents = parseSession(f, "/test", "test");
      const asyncEvents = await parseSessionAsync(f, "/test", "test");

      expect(asyncEvents.length).toBe(syncEvents.length);
      for (let i = 0; i < syncEvents.length; i++) {
        expect(asyncEvents[i].type).toBe(syncEvents[i].type);
        expect(asyncEvents[i].content).toBe(syncEvents[i].content);
      }
    });
  });

  describe("findSessionFiles", () => {
    it("finds .jsonl files in directory", () => {
      writeJsonl(dir, "session-a.jsonl", [USER_PROMPT]);
      writeJsonl(dir, "session-b.jsonl", [USER_PROMPT]);
      writeFileSync(join(dir, "notes.txt"), "not a session");
      const files = findSessionFiles(dir);
      expect(files).toHaveLength(2);
      expect(files.every((f) => f.path.endsWith(".jsonl"))).toBe(true);
    });

    it("finds subagent session files", () => {
      const subDir = join(dir, "parent-uuid", "subagents");
      mkdirSync(subDir, { recursive: true });
      writeJsonl(subDir, "sub-agent.jsonl", [USER_PROMPT]);
      const files = findSessionFiles(dir);
      expect(files).toHaveLength(1);
      expect(files[0].sessionId).toBe("sub-agent");
    });

    it("returns empty for nonexistent directory", () => {
      const files = findSessionFiles("/nonexistent/path");
      expect(files).toHaveLength(0);
    });
  });

  describe("parseAllSessions", () => {
    it("parses all session files and sorts by timestamp", () => {
      const early = {
        type: "user",
        timestamp: "2026-03-15T08:00:00Z",
        message: { content: "early" },
      };
      const late = {
        type: "user",
        timestamp: "2026-03-16T20:00:00Z",
        message: { content: "late" },
      };
      writeJsonl(dir, "sess-late.jsonl", [late]);
      writeJsonl(dir, "sess-early.jsonl", [early]);
      const events = parseAllSessions(dir);
      expect(events).toHaveLength(2);
      expect(events[0].content).toBe("early");
      expect(events[1].content).toBe("late");
    });

    it("filters by since date", () => {
      const old = {
        type: "user",
        timestamp: "2026-01-01T00:00:00Z",
        message: { content: "old" },
      };
      const p = writeJsonl(dir, "old.jsonl", [old]);
      // Set mtime to the past
      const events = parseAllSessions(dir, { since: new Date("2027-01-01") });
      expect(events).toHaveLength(0);
    });
  });
});
