/**
 * Tests for src/lib/session-parser.ts
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, statSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
  findSessionDirs,
  findSessionFiles,
  parseSession,
  parseSessionAsync,
  parseAllSessions,
} from "../../src/lib/session-parser.js";

// Helper to create temp dirs with JSONL content
function makeTmpDir(): string {
  return mkdtempSync(join(tmpdir(), "sp-test-"));
}

function writeJsonl(dir: string, filename: string, records: any[]): string {
  const p = join(dir, filename);
  writeFileSync(p, records.map((r) => JSON.stringify(r)).join("\n") + "\n");
  return p;
}

describe("session-parser", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  // ── findSessionFiles ───────────────────────────────────────────────────

  describe("findSessionFiles", () => {
    it("returns empty for nonexistent dir", () => {
      expect(findSessionFiles("/no/such/dir")).toEqual([]);
    });

    it("finds .jsonl files at top level", () => {
      writeJsonl(tmpDir, "abc.jsonl", [{ type: "user" }]);
      writeJsonl(tmpDir, "def.jsonl", [{ type: "user" }]);
      writeFileSync(join(tmpDir, "readme.txt"), "not a session");

      const files = findSessionFiles(tmpDir);
      expect(files).toHaveLength(2);
      expect(files.map((f) => f.sessionId).sort()).toEqual(["abc", "def"]);
      expect(files[0].mtime).toBeInstanceOf(Date);
    });

    it("finds subagent session files", () => {
      // Create parent session dir with subagents subdir
      const parentDir = join(tmpDir, "parent-uuid");
      const subDir = join(parentDir, "subagents");
      mkdirSync(subDir, { recursive: true });
      writeJsonl(subDir, "sub-uuid.jsonl", [{ type: "user" }]);

      const files = findSessionFiles(tmpDir);
      expect(files).toHaveLength(1);
      expect(files[0].sessionId).toBe("sub-uuid");
    });
  });

  // ── parseSession ───────────────────────────────────────────────────────

  describe("parseSession", () => {
    it("parses user prompts", () => {
      const fp = writeJsonl(tmpDir, "s1.jsonl", [
        { type: "user", timestamp: "2025-01-01T00:00:00Z", message: { content: "Hello world" } },
      ]);
      const events = parseSession(fp, "/test", "test");
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe("prompt");
      expect(events[0].content).toBe("Hello world");
      expect(events[0].project).toBe("/test");
      expect(events[0].project_name).toBe("test");
    });

    it("parses array content blocks", () => {
      const fp = writeJsonl(tmpDir, "s1.jsonl", [
        {
          type: "user",
          timestamp: "2025-01-01T00:00:00Z",
          message: { content: [{ type: "text", text: "part1" }, { type: "text", text: "part2" }] },
        },
      ]);
      const events = parseSession(fp, "/p", "p");
      expect(events[0].content).toBe("part1\npart2");
    });

    it("detects corrections after assistant messages", () => {
      const fp = writeJsonl(tmpDir, "s1.jsonl", [
        { type: "assistant", timestamp: "2025-01-01T00:00:00Z", message: { content: "Here's the code" } },
        { type: "user", timestamp: "2025-01-01T00:00:01Z", message: { content: "No, that's wrong" } },
      ]);
      const events = parseSession(fp, "/p", "p");
      const correction = events.find((e) => e.type === "correction");
      expect(correction).toBeDefined();
      expect(correction!.content).toBe("No, that's wrong");
    });

    it("does not flag as correction when no prior assistant", () => {
      const fp = writeJsonl(tmpDir, "s1.jsonl", [
        { type: "user", timestamp: "2025-01-01T00:00:00Z", message: { content: "No, that's wrong" } },
      ]);
      const events = parseSession(fp, "/p", "p");
      // First message can't be correction (no prior assistant)
      expect(events[0].type).toBe("prompt");
    });

    it("parses assistant text and tool_use blocks", () => {
      const fp = writeJsonl(tmpDir, "s1.jsonl", [
        {
          type: "assistant",
          timestamp: "2025-01-01T00:00:00Z",
          model: "claude-3",
          message: {
            content: [
              { type: "text", text: "Let me check" },
              { type: "tool_use", name: "Read", input: { path: "/foo" } },
            ],
          },
        },
      ]);
      const events = parseSession(fp, "/p", "p");
      expect(events).toHaveLength(2);
      expect(events[0].type).toBe("assistant");
      expect(events[0].content).toBe("Let me check");
      expect(JSON.parse(events[0].metadata).model).toBe("claude-3");
      expect(events[1].type).toBe("tool_call");
      expect(events[1].content).toContain("Read:");
    });

    it("detects sub_agent_spawn for Task tool", () => {
      const fp = writeJsonl(tmpDir, "s1.jsonl", [
        {
          type: "assistant",
          timestamp: "2025-01-01T00:00:00Z",
          message: {
            content: [{ type: "tool_use", name: "Task", input: { task: "do stuff" } }],
          },
        },
      ]);
      const events = parseSession(fp, "/p", "p");
      expect(events[0].type).toBe("sub_agent_spawn");
    });

    it("detects sub_agent_spawn for dispatch_agent tool", () => {
      const fp = writeJsonl(tmpDir, "s1.jsonl", [
        {
          type: "assistant",
          timestamp: "2025-01-01T00:00:00Z",
          message: {
            content: [{ type: "tool_use", name: "dispatch_agent", input: {} }],
          },
        },
      ]);
      const events = parseSession(fp, "/p", "p");
      expect(events[0].type).toBe("sub_agent_spawn");
    });

    it("parses tool_result errors", () => {
      const fp = writeJsonl(tmpDir, "s1.jsonl", [
        { type: "tool_result", timestamp: "2025-01-01T00:00:00Z", is_error: true, content: "ENOENT: file not found", tool_use_id: "tu_123" },
      ]);
      const events = parseSession(fp, "/p", "p");
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe("error");
      expect(events[0].content).toContain("ENOENT");
    });

    it("detects stderr in tool_result as error", () => {
      const fp = writeJsonl(tmpDir, "s1.jsonl", [
        { type: "tool_result", timestamp: "2025-01-01T00:00:00Z", content: "stderr: something failed" },
      ]);
      const events = parseSession(fp, "/p", "p");
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe("error");
    });

    it("parses compaction events from system type", () => {
      const fp = writeJsonl(tmpDir, "s1.jsonl", [
        { type: "system", timestamp: "2025-01-01T00:00:00Z", subtype: "compaction", content: "compacted" },
      ]);
      const events = parseSession(fp, "/p", "p");
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe("compaction");
    });

    it("parses compaction via text match", () => {
      const fp = writeJsonl(tmpDir, "s1.jsonl", [
        { type: "system", timestamp: "2025-01-01T00:00:00Z", message: { content: "Context was compacted to save tokens" } },
      ]);
      const events = parseSession(fp, "/p", "p");
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe("compaction");
    });

    it("extracts branch and sessionId from summary records", () => {
      const fp = writeJsonl(tmpDir, "s1.jsonl", [
        { type: "summary", gitBranch: "feat/cool", sessionId: "custom-id" },
        { type: "user", timestamp: "2025-01-01T00:00:00Z", message: { content: "hi" } },
      ]);
      const events = parseSession(fp, "/p", "p");
      expect(events[0].branch).toBe("feat/cool");
      expect(events[0].session_id).toBe("custom-id");
    });

    it("handles malformed JSON lines gracefully", () => {
      const fp = join(tmpDir, "bad.jsonl");
      writeFileSync(fp, '{"type":"user","message":{"content":"ok"}}\nnot json\n{"type":"user","message":{"content":"two"}}\n');

      // Suppress stderr
      const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
      const events = parseSession(fp, "/p", "p");
      stderrSpy.mockRestore();

      expect(events).toHaveLength(2);
    });

    it("skips user messages with empty content", () => {
      const fp = writeJsonl(tmpDir, "s1.jsonl", [
        { type: "user", timestamp: "2025-01-01T00:00:00Z", message: { content: "" } },
        { type: "user", timestamp: "2025-01-01T00:00:01Z", message: { content: [] } },
      ]);
      const events = parseSession(fp, "/p", "p");
      expect(events).toHaveLength(0);
    });

    it("normalizes epoch timestamps", () => {
      const fp = writeJsonl(tmpDir, "s1.jsonl", [
        { type: "user", timestamp: 1704067200, message: { content: "epoch seconds" } },
      ]);
      const events = parseSession(fp, "/p", "p");
      expect(events[0].timestamp).toBe("2024-01-01T00:00:00.000Z");
    });

    it("normalizes epoch ms timestamps", () => {
      const fp = writeJsonl(tmpDir, "s1.jsonl", [
        { type: "user", timestamp: 1704067200000, message: { content: "epoch ms" } },
      ]);
      const events = parseSession(fp, "/p", "p");
      expect(events[0].timestamp).toBe("2024-01-01T00:00:00.000Z");
    });

    it("falls back to file mtime for missing timestamps", () => {
      const fp = writeJsonl(tmpDir, "s1.jsonl", [
        { type: "user", message: { content: "no ts" } },
      ]);
      const events = parseSession(fp, "/p", "p");
      const mtime = statSync(fp).mtime.toISOString();
      expect(events[0].timestamp).toBe(mtime);
    });

    it("truncates long content_preview", () => {
      const longText = "x".repeat(200);
      const fp = writeJsonl(tmpDir, "s1.jsonl", [
        { type: "user", timestamp: "2025-01-01T00:00:00Z", message: { content: longText } },
      ]);
      const events = parseSession(fp, "/p", "p");
      expect(events[0].content_preview.length).toBeLessThanOrEqual(121); // 120 + "…"
      expect(events[0].content_preview.endsWith("…")).toBe(true);
    });

    it("generates unique IDs for each event", () => {
      const fp = writeJsonl(tmpDir, "s1.jsonl", [
        { type: "user", timestamp: "2025-01-01T00:00:00Z", message: { content: "a" } },
        { type: "user", timestamp: "2025-01-01T00:00:01Z", message: { content: "b" } },
      ]);
      const events = parseSession(fp, "/p", "p");
      expect(events[0].id).not.toBe(events[1].id);
    });

    it("handles all correction patterns", () => {
      const patterns = ["no", "wrong", "not that", "i meant", "actually", "instead", "undo"];
      for (const word of patterns) {
        const fp = writeJsonl(tmpDir, `corr-${word.replace(/\s/g, "")}.jsonl`, [
          { type: "assistant", timestamp: "2025-01-01T00:00:00Z", message: { content: "response" } },
          { type: "user", timestamp: "2025-01-01T00:00:01Z", message: { content: `${word} do it differently` } },
        ]);
        const events = parseSession(fp, "/p", "p");
        const corr = events.find((e) => e.type === "correction");
        expect(corr, `pattern "${word}" should be detected as correction`).toBeDefined();
      }
    });
  });

  // ── parseSessionAsync ──────────────────────────────────────────────────

  describe("parseSessionAsync", () => {
    it("produces same results as sync parser", async () => {
      const fp = writeJsonl(tmpDir, "s1.jsonl", [
        { type: "summary", gitBranch: "main", sessionId: "sess-1" },
        { type: "user", timestamp: "2025-01-01T00:00:00Z", message: { content: "hello" } },
        { type: "assistant", timestamp: "2025-01-01T00:00:01Z", message: { content: "hi there" } },
        { type: "user", timestamp: "2025-01-01T00:00:02Z", message: { content: "no that's wrong" } },
      ]);

      const syncEvents = parseSession(fp, "/p", "p");
      const asyncEvents = await parseSessionAsync(fp, "/p", "p");

      // Same number of events, same types
      expect(asyncEvents.length).toBe(syncEvents.length);
      for (let i = 0; i < syncEvents.length; i++) {
        expect(asyncEvents[i].type).toBe(syncEvents[i].type);
        expect(asyncEvents[i].content).toBe(syncEvents[i].content);
        expect(asyncEvents[i].branch).toBe(syncEvents[i].branch);
      }
    });
  });

  // ── parseAllSessions ───────────────────────────────────────────────────

  describe("parseAllSessions", () => {
    it("parses all jsonl files and sorts by timestamp", () => {
      writeJsonl(tmpDir, "a.jsonl", [
        { type: "user", timestamp: "2025-01-01T02:00:00Z", message: { content: "second" } },
      ]);
      writeJsonl(tmpDir, "b.jsonl", [
        { type: "user", timestamp: "2025-01-01T01:00:00Z", message: { content: "first" } },
      ]);

      const events = parseAllSessions(tmpDir);
      expect(events).toHaveLength(2);
      expect(events[0].content).toBe("first");
      expect(events[1].content).toBe("second");
    });

    it("respects since filter", () => {
      const oldFile = writeJsonl(tmpDir, "old.jsonl", [
        { type: "user", timestamp: "2020-01-01T00:00:00Z", message: { content: "old" } },
      ]);
      // Backdate the file
      const { utimesSync } = require("fs");
      utimesSync(oldFile, new Date("2020-01-01"), new Date("2020-01-01"));

      writeJsonl(tmpDir, "new.jsonl", [
        { type: "user", timestamp: "2025-01-01T00:00:00Z", message: { content: "new" } },
      ]);

      const events = parseAllSessions(tmpDir, { since: new Date("2024-01-01") });
      expect(events).toHaveLength(1);
      expect(events[0].content).toBe("new");
    });
  });
});
