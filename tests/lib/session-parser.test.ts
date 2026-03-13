/**
 * Tests for src/lib/session-parser.ts
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { writeFileSync, mkdirSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
  findSessionFiles,
  parseSession,
  parseSessionAsync,
  parseAllSessions,
} from "../../src/lib/session-parser.js";

function tmpDir(): string {
  const d = join(tmpdir(), `preflight-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(d, { recursive: true });
  return d;
}

function writeLine(path: string, ...objs: any[]) {
  writeFileSync(path, objs.map((o) => JSON.stringify(o)).join("\n") + "\n");
}

describe("session-parser", () => {
  let dir: string;

  beforeEach(() => {
    dir = tmpDir();
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  describe("findSessionFiles", () => {
    it("returns empty for non-existent dir", () => {
      expect(findSessionFiles("/no/such/dir")).toEqual([]);
    });

    it("finds .jsonl files in root", () => {
      writeFileSync(join(dir, "abc-123.jsonl"), "{}");
      writeFileSync(join(dir, "readme.md"), "hi");
      const files = findSessionFiles(dir);
      expect(files).toHaveLength(1);
      expect(files[0].sessionId).toBe("abc-123");
    });

    it("finds subagent files", () => {
      const subDir = join(dir, "parent-uuid", "subagents");
      mkdirSync(subDir, { recursive: true });
      writeFileSync(join(subDir, "child-uuid.jsonl"), "{}");
      const files = findSessionFiles(dir);
      expect(files).toHaveLength(1);
      expect(files[0].sessionId).toBe("child-uuid");
    });
  });

  describe("parseSession", () => {
    it("parses user prompts", () => {
      const f = join(dir, "sess.jsonl");
      writeLine(f, {
        type: "user",
        timestamp: "2025-01-15T10:00:00Z",
        message: { content: "Fix the bug in auth.ts" },
      });
      const events = parseSession(f, "/project", "project");
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe("prompt");
      expect(events[0].content).toBe("Fix the bug in auth.ts");
      expect(events[0].timestamp).toBe("2025-01-15T10:00:00.000Z");
    });

    it("detects corrections", () => {
      const f = join(dir, "sess.jsonl");
      writeLine(
        f,
        { type: "assistant", timestamp: "2025-01-15T10:00:00Z", message: { content: "Done." } },
        { type: "user", timestamp: "2025-01-15T10:00:05Z", message: { content: "No, that's wrong" } },
      );
      const events = parseSession(f, "/p", "p");
      const correction = events.find((e) => e.type === "correction");
      expect(correction).toBeDefined();
      expect(correction!.content).toBe("No, that's wrong");
    });

    it("parses assistant text and tool_use blocks", () => {
      const f = join(dir, "sess.jsonl");
      writeLine(f, {
        type: "assistant",
        timestamp: "2025-01-15T10:00:00Z",
        model: "claude-3-opus",
        message: {
          content: [
            { type: "text", text: "Let me fix that." },
            { type: "tool_use", name: "Edit", input: { file: "a.ts", old: "x", new: "y" } },
          ],
        },
      });
      const events = parseSession(f, "/p", "p");
      expect(events).toHaveLength(2);
      expect(events[0].type).toBe("assistant");
      expect(events[0].content).toBe("Let me fix that.");
      expect(events[1].type).toBe("tool_call");
      expect(events[1].content).toContain("Edit:");
    });

    it("detects sub_agent_spawn for Task tool", () => {
      const f = join(dir, "sess.jsonl");
      writeLine(f, {
        type: "assistant",
        timestamp: "2025-01-15T10:00:00Z",
        message: {
          content: [
            { type: "tool_use", name: "Task", input: { description: "review code" } },
          ],
        },
      });
      const events = parseSession(f, "/p", "p");
      expect(events[0].type).toBe("sub_agent_spawn");
    });

    it("parses tool_result errors", () => {
      const f = join(dir, "sess.jsonl");
      writeLine(f, {
        type: "tool_result",
        timestamp: "2025-01-15T10:00:00Z",
        is_error: true,
        content: "Command failed with exit code 1",
        tool_use_id: "tu_123",
      });
      const events = parseSession(f, "/p", "p");
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe("error");
    });

    it("parses compaction events", () => {
      const f = join(dir, "sess.jsonl");
      writeLine(f, {
        type: "system",
        timestamp: "2025-01-15T10:00:00Z",
        subtype: "compaction",
        message: { content: "Context was compacted" },
      });
      const events = parseSession(f, "/p", "p");
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe("compaction");
    });

    it("reads branch from summary record", () => {
      const f = join(dir, "sess.jsonl");
      writeLine(
        f,
        { type: "summary", gitBranch: "feat/auth", sessionId: "s1" },
        { type: "user", timestamp: "2025-01-15T10:00:00Z", message: { content: "hi" } },
      );
      const events = parseSession(f, "/p", "p");
      expect(events[0].branch).toBe("feat/auth");
      expect(events[0].session_id).toBe("s1");
    });

    it("handles malformed lines gracefully", () => {
      const f = join(dir, "sess.jsonl");
      writeFileSync(f, "not json\n" + JSON.stringify({ type: "user", timestamp: "2025-01-15T10:00:00Z", message: { content: "ok" } }) + "\n");
      const events = parseSession(f, "/p", "p");
      expect(events).toHaveLength(1);
    });

    it("normalizes epoch timestamps", () => {
      const f = join(dir, "sess.jsonl");
      writeLine(f, {
        type: "user",
        timestamp: 1705312800, // epoch seconds
        message: { content: "epoch test" },
      });
      const events = parseSession(f, "/p", "p");
      expect(events[0].timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it("handles content as array of text blocks", () => {
      const f = join(dir, "sess.jsonl");
      writeLine(f, {
        type: "user",
        timestamp: "2025-01-15T10:00:00Z",
        message: {
          content: [
            { type: "text", text: "line one" },
            { type: "image", source: {} },
            { type: "text", text: "line two" },
          ],
        },
      });
      const events = parseSession(f, "/p", "p");
      expect(events[0].content).toBe("line one\nline two");
    });
  });

  describe("parseSessionAsync", () => {
    it("produces same results as sync parser", async () => {
      const f = join(dir, "sess.jsonl");
      writeLine(
        f,
        { type: "summary", gitBranch: "main", sessionId: "s1" },
        { type: "user", timestamp: "2025-01-15T10:00:00Z", message: { content: "hello" } },
        { type: "assistant", timestamp: "2025-01-15T10:00:01Z", message: { content: "hi" } },
        { type: "user", timestamp: "2025-01-15T10:00:02Z", message: { content: "no, wrong" } },
      );
      const syncEvents = parseSession(f, "/p", "p");
      const asyncEvents = await parseSessionAsync(f, "/p", "p");

      // Same number and types (ids differ since they're random UUIDs)
      expect(asyncEvents.map((e) => e.type)).toEqual(syncEvents.map((e) => e.type));
      expect(asyncEvents.map((e) => e.content)).toEqual(syncEvents.map((e) => e.content));
    });
  });

  describe("parseAllSessions", () => {
    it("parses all files and sorts by timestamp", () => {
      const f1 = join(dir, "a.jsonl");
      const f2 = join(dir, "b.jsonl");
      writeLine(f1, { type: "user", timestamp: "2025-01-15T12:00:00Z", message: { content: "later" } });
      writeLine(f2, { type: "user", timestamp: "2025-01-15T10:00:00Z", message: { content: "earlier" } });
      const events = parseAllSessions(dir);
      expect(events).toHaveLength(2);
      expect(events[0].content).toBe("earlier");
      expect(events[1].content).toBe("later");
    });

    it("respects since filter", () => {
      const f = join(dir, "old.jsonl");
      writeLine(f, { type: "user", timestamp: "2020-01-01T00:00:00Z", message: { content: "old" } });
      // File mtime is now, so it should be included despite old content timestamp
      const events = parseAllSessions(dir, { since: new Date("2020-01-01") });
      expect(events.length).toBeGreaterThanOrEqual(1);
    });
  });
});
