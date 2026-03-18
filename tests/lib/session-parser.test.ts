import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { parseSession, findSessionFiles } from "../../src/lib/session-parser.js";

// ── Test Helpers ───────────────────────────────────────────────────────────

function makeTmpDir(): string {
  return mkdtempSync(join(tmpdir(), "preflight-test-"));
}

function writeJsonl(dir: string, filename: string, records: any[]): string {
  const path = join(dir, filename);
  writeFileSync(path, records.map((r) => JSON.stringify(r)).join("\n") + "\n");
  return path;
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe("session-parser", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("findSessionFiles", () => {
    it("returns empty array for non-existent directory", () => {
      const result = findSessionFiles("/tmp/does-not-exist-xyz");
      expect(result).toEqual([]);
    });

    it("finds .jsonl files in a directory", () => {
      writeFileSync(join(tmpDir, "session-1.jsonl"), "{}");
      writeFileSync(join(tmpDir, "session-2.jsonl"), "{}");
      writeFileSync(join(tmpDir, "readme.txt"), "ignored");

      const result = findSessionFiles(tmpDir);
      expect(result).toHaveLength(2);
      expect(result.map((r) => r.sessionId).sort()).toEqual(["session-1", "session-2"]);
    });

    it("finds subagent JSONL files", () => {
      const subDir = join(tmpDir, "parent-session", "subagents");
      mkdirSync(subDir, { recursive: true });
      writeFileSync(join(subDir, "sub-1.jsonl"), "{}");

      const result = findSessionFiles(tmpDir);
      expect(result).toHaveLength(1);
      expect(result[0].sessionId).toBe("sub-1");
    });

    it("returns mtime for each file", () => {
      writeFileSync(join(tmpDir, "test.jsonl"), "{}");
      const result = findSessionFiles(tmpDir);
      expect(result[0].mtime).toBeInstanceOf(Date);
    });
  });

  describe("parseSession", () => {
    it("parses user prompts into timeline events", () => {
      const path = writeJsonl(tmpDir, "test.jsonl", [
        { type: "user", message: { content: "Hello world" }, timestamp: "2025-01-01T00:00:00Z" },
      ]);

      const events = parseSession(path, "/test", "test");
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe("prompt");
      expect(events[0].content).toBe("Hello world");
      expect(events[0].project).toBe("/test");
      expect(events[0].project_name).toBe("test");
    });

    it("parses assistant responses", () => {
      const path = writeJsonl(tmpDir, "test.jsonl", [
        { type: "assistant", message: { content: "I'll help you" }, timestamp: "2025-01-01T00:00:00Z" },
      ]);

      const events = parseSession(path, "/test", "test");
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe("assistant");
      expect(events[0].content).toBe("I'll help you");
    });

    it("handles content block arrays", () => {
      const path = writeJsonl(tmpDir, "test.jsonl", [
        {
          type: "user",
          message: { content: [{ type: "text", text: "block one" }, { type: "text", text: "block two" }] },
          timestamp: "2025-01-01T00:00:00Z",
        },
      ]);

      const events = parseSession(path, "/test", "test");
      expect(events[0].content).toBe("block one\nblock two");
    });

    it("detects corrections after assistant messages", () => {
      const path = writeJsonl(tmpDir, "test.jsonl", [
        { type: "assistant", message: { content: "Here's the code" }, timestamp: "2025-01-01T00:00:00Z" },
        { type: "user", message: { content: "No, that's wrong" }, timestamp: "2025-01-01T00:01:00Z" },
      ]);

      const events = parseSession(path, "/test", "test");
      const correction = events.find((e) => e.type === "correction");
      expect(correction).toBeDefined();
      expect(correction!.content).toBe("No, that's wrong");
    });

    it("does not flag first user message as correction", () => {
      const path = writeJsonl(tmpDir, "test.jsonl", [
        { type: "user", message: { content: "No, actually do this instead" }, timestamp: "2025-01-01T00:00:00Z" },
      ]);

      const events = parseSession(path, "/test", "test");
      expect(events[0].type).toBe("prompt");
    });

    it("extracts tool calls from assistant messages", () => {
      const path = writeJsonl(tmpDir, "test.jsonl", [
        {
          type: "assistant",
          message: {
            content: [
              { type: "text", text: "Let me check" },
              { type: "tool_use", name: "Read", input: { path: "/foo" } },
            ],
          },
          timestamp: "2025-01-01T00:00:00Z",
        },
      ]);

      const events = parseSession(path, "/test", "test");
      const toolCall = events.find((e) => e.type === "tool_call");
      expect(toolCall).toBeDefined();
      expect(toolCall!.content).toContain("Read");
    });

    it("detects sub_agent_spawn for Task tool", () => {
      const path = writeJsonl(tmpDir, "test.jsonl", [
        {
          type: "assistant",
          message: {
            content: [{ type: "tool_use", name: "Task", input: { description: "do stuff" } }],
          },
          timestamp: "2025-01-01T00:00:00Z",
        },
      ]);

      const events = parseSession(path, "/test", "test");
      expect(events.some((e) => e.type === "sub_agent_spawn")).toBe(true);
    });

    it("detects sub_agent_spawn for dispatch_agent tool", () => {
      const path = writeJsonl(tmpDir, "test.jsonl", [
        {
          type: "assistant",
          message: {
            content: [{ type: "tool_use", name: "dispatch_agent", input: {} }],
          },
          timestamp: "2025-01-01T00:00:00Z",
        },
      ]);

      const events = parseSession(path, "/test", "test");
      expect(events.some((e) => e.type === "sub_agent_spawn")).toBe(true);
    });

    it("detects errors in tool_result", () => {
      const path = writeJsonl(tmpDir, "test.jsonl", [
        { type: "tool_result", is_error: true, content: "Command failed", timestamp: "2025-01-01T00:00:00Z" },
      ]);

      const events = parseSession(path, "/test", "test");
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe("error");
    });

    it("detects compaction events", () => {
      const path = writeJsonl(tmpDir, "test.jsonl", [
        { type: "system", message: { content: "Context compacted" }, timestamp: "2025-01-01T00:00:00Z" },
      ]);

      const events = parseSession(path, "/test", "test");
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe("compaction");
    });

    it("handles summary records (branch + session id)", () => {
      const path = writeJsonl(tmpDir, "test.jsonl", [
        { type: "summary", gitBranch: "feat/cool", sessionId: "abc123" },
        { type: "user", message: { content: "hi" }, timestamp: "2025-01-01T00:00:00Z" },
      ]);

      const events = parseSession(path, "/test", "test");
      expect(events).toHaveLength(1);
      expect(events[0].branch).toBe("feat/cool");
      expect(events[0].session_id).toBe("abc123");
    });

    it("skips malformed JSON lines gracefully", () => {
      const path = join(tmpDir, "test.jsonl");
      writeFileSync(
        path,
        '{"type":"user","message":{"content":"valid"},"timestamp":"2025-01-01T00:00:00Z"}\nthis is not json\n{"type":"user","message":{"content":"also valid"},"timestamp":"2025-01-01T00:01:00Z"}\n',
      );

      const events = parseSession(path, "/test", "test");
      expect(events).toHaveLength(2);
    });

    it("handles empty file", () => {
      const path = join(tmpDir, "empty.jsonl");
      writeFileSync(path, "");

      const events = parseSession(path, "/test", "test");
      expect(events).toHaveLength(0);
    });

    it("normalizes epoch timestamps", () => {
      const path = writeJsonl(tmpDir, "test.jsonl", [
        { type: "user", message: { content: "hello" }, timestamp: 1704067200 },
      ]);

      const events = parseSession(path, "/test", "test");
      expect(events[0].timestamp).toBe("2024-01-01T00:00:00.000Z");
    });

    it("normalizes epoch millisecond timestamps", () => {
      const path = writeJsonl(tmpDir, "test.jsonl", [
        { type: "user", message: { content: "hello" }, timestamp: 1704067200000 },
      ]);

      const events = parseSession(path, "/test", "test");
      expect(events[0].timestamp).toBe("2024-01-01T00:00:00.000Z");
    });

    it("generates unique ids for each event", () => {
      const path = writeJsonl(tmpDir, "test.jsonl", [
        { type: "user", message: { content: "one" }, timestamp: "2025-01-01T00:00:00Z" },
        { type: "user", message: { content: "two" }, timestamp: "2025-01-01T00:01:00Z" },
      ]);

      const events = parseSession(path, "/test", "test");
      expect(events[0].id).not.toBe(events[1].id);
    });

    it("creates content_preview from first line", () => {
      const path = writeJsonl(tmpDir, "test.jsonl", [
        { type: "user", message: { content: "first line\nsecond line\nthird line" }, timestamp: "2025-01-01T00:00:00Z" },
      ]);

      const events = parseSession(path, "/test", "test");
      expect(events[0].content_preview).toBe("first line");
    });

    it("truncates long previews", () => {
      const longText = "a".repeat(200);
      const path = writeJsonl(tmpDir, "test.jsonl", [
        { type: "user", message: { content: longText }, timestamp: "2025-01-01T00:00:00Z" },
      ]);

      const events = parseSession(path, "/test", "test");
      expect(events[0].content_preview.length).toBeLessThanOrEqual(121); // 120 + "…"
    });

    it("handles tool_result with stderr pattern as error", () => {
      const path = writeJsonl(tmpDir, "test.jsonl", [
        { type: "tool_result", content: "stderr: something failed", timestamp: "2025-01-01T00:00:00Z" },
      ]);

      const events = parseSession(path, "/test", "test");
      expect(events[0].type).toBe("error");
    });

    it("ignores non-error tool_result records", () => {
      const path = writeJsonl(tmpDir, "test.jsonl", [
        { type: "tool_result", content: "file contents here", timestamp: "2025-01-01T00:00:00Z" },
      ]);

      const events = parseSession(path, "/test", "test");
      expect(events).toHaveLength(0);
    });

    it("records source_file and source_line", () => {
      const path = writeJsonl(tmpDir, "test.jsonl", [
        { type: "user", message: { content: "hi" }, timestamp: "2025-01-01T00:00:00Z" },
      ]);

      const events = parseSession(path, "/test", "test");
      expect(events[0].source_file).toBe(path);
      expect(events[0].source_line).toBeGreaterThan(0);
    });

    it("handles multiple correction patterns", () => {
      const corrections = ["undo that", "i meant something else", "actually do this", "not that one"];
      for (const text of corrections) {
        const path = writeJsonl(tmpDir, `test-${text.replace(/\s/g, "-")}.jsonl`, [
          { type: "assistant", message: { content: "done" }, timestamp: "2025-01-01T00:00:00Z" },
          { type: "user", message: { content: text }, timestamp: "2025-01-01T00:01:00Z" },
        ]);

        const events = parseSession(path, "/test", "test");
        const hasCorrection = events.some((e) => e.type === "correction");
        expect(hasCorrection, `"${text}" should be detected as correction`).toBe(true);
      }
    });
  });
});
