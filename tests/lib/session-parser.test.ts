/**
 * Tests for src/lib/session-parser.ts
 *
 * Covers: extractText, normalizeTimestamp, preview, isCorrection,
 *         processRecord (prompt/assistant/tool_call/error/compaction detection),
 *         and parseSession end-to-end with temp JSONL files.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { writeFileSync, mkdirSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { parseSession, parseSessionAsync } from "../../src/lib/session-parser.js";

// ── Helpers (re-test via parseSession output) ─────────────────────────────

const TMP = join(tmpdir(), `pf-session-parser-test-${Date.now()}`);

beforeAll(() => mkdirSync(TMP, { recursive: true }));
afterAll(() => rmSync(TMP, { recursive: true, force: true }));

function writeTmpJsonl(name: string, records: any[]): string {
  const p = join(TMP, name);
  writeFileSync(p, records.map((r) => JSON.stringify(r)).join("\n") + "\n");
  return p;
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe("parseSession", () => {
  it("parses user prompts", () => {
    const f = writeTmpJsonl("prompt.jsonl", [
      { type: "user", message: { content: "Hello world" }, timestamp: "2025-01-01T00:00:00Z" },
    ]);
    const events = parseSession(f, "/test", "test");
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("prompt");
    expect(events[0].content).toBe("Hello world");
    expect(events[0].timestamp).toBe("2025-01-01T00:00:00.000Z");
  });

  it("parses user prompts with content blocks", () => {
    const f = writeTmpJsonl("blocks.jsonl", [
      {
        type: "user",
        message: { content: [{ type: "text", text: "line1" }, { type: "text", text: "line2" }] },
        timestamp: "2025-01-01T00:00:00Z",
      },
    ]);
    const events = parseSession(f, "/test", "test");
    expect(events).toHaveLength(1);
    expect(events[0].content).toBe("line1\nline2");
  });

  it("detects corrections after assistant messages", () => {
    const f = writeTmpJsonl("correction.jsonl", [
      { type: "user", message: { content: "Do X" }, timestamp: "2025-01-01T00:00:00Z" },
      { type: "assistant", message: { content: [{ type: "text", text: "Done" }] }, timestamp: "2025-01-01T00:00:01Z" },
      { type: "user", message: { content: "No, wrong, undo that" }, timestamp: "2025-01-01T00:00:02Z" },
    ]);
    const events = parseSession(f, "/test", "test");
    const types = events.map((e) => e.type);
    expect(types).toContain("correction");
  });

  it("does not flag first prompt as correction", () => {
    const f = writeTmpJsonl("no-corr.jsonl", [
      { type: "user", message: { content: "No problem here" }, timestamp: "2025-01-01T00:00:00Z" },
    ]);
    const events = parseSession(f, "/test", "test");
    expect(events[0].type).toBe("prompt");
  });

  it("extracts tool_call events from assistant content", () => {
    const f = writeTmpJsonl("tools.jsonl", [
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
    const events = parseSession(f, "/test", "test");
    const toolEvent = events.find((e) => e.type === "tool_call");
    expect(toolEvent).toBeDefined();
    expect(toolEvent!.content).toContain("Read");
  });

  it("detects sub_agent_spawn for Task tool", () => {
    const f = writeTmpJsonl("subagent.jsonl", [
      {
        type: "assistant",
        message: {
          content: [{ type: "tool_use", name: "Task", input: { description: "do stuff" } }],
        },
        timestamp: "2025-01-01T00:00:00Z",
      },
    ]);
    const events = parseSession(f, "/test", "test");
    expect(events.some((e) => e.type === "sub_agent_spawn")).toBe(true);
  });

  it("detects errors from tool_result", () => {
    const f = writeTmpJsonl("error.jsonl", [
      { type: "tool_result", is_error: true, content: "Something failed", timestamp: "2025-01-01T00:00:00Z" },
    ]);
    const events = parseSession(f, "/test", "test");
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("error");
  });

  it("detects compaction events", () => {
    const f = writeTmpJsonl("compaction.jsonl", [
      { type: "system", message: { content: "Context compacted" }, timestamp: "2025-01-01T00:00:00Z" },
    ]);
    const events = parseSession(f, "/test", "test");
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("compaction");
  });

  it("skips summary records but extracts branch", () => {
    const f = writeTmpJsonl("summary.jsonl", [
      { type: "summary", gitBranch: "main", sessionId: "abc-123" },
      { type: "user", message: { content: "hello" }, timestamp: "2025-01-01T00:00:00Z" },
    ]);
    const events = parseSession(f, "/test", "test");
    expect(events).toHaveLength(1);
    expect(events[0].branch).toBe("main");
    expect(events[0].session_id).toBe("abc-123");
  });

  it("handles malformed JSON lines gracefully", () => {
    const p = join(TMP, "malformed.jsonl");
    writeFileSync(p, '{"type":"user","message":{"content":"ok"},"timestamp":"2025-01-01T00:00:00Z"}\nNOT_JSON\n');
    const events = parseSession(p, "/test", "test");
    expect(events).toHaveLength(1);
  });

  it("normalizes epoch timestamps", () => {
    const f = writeTmpJsonl("epoch.jsonl", [
      { type: "user", message: { content: "hi" }, timestamp: 1704067200 },
    ]);
    const events = parseSession(f, "/test", "test");
    expect(events[0].timestamp).toBe("2024-01-01T00:00:00.000Z");
  });

  it("normalizes epoch-ms timestamps", () => {
    const f = writeTmpJsonl("epoch-ms.jsonl", [
      { type: "user", message: { content: "hi" }, timestamp: 1704067200000 },
    ]);
    const events = parseSession(f, "/test", "test");
    expect(events[0].timestamp).toBe("2024-01-01T00:00:00.000Z");
  });

  it("skips user messages with empty content", () => {
    const f = writeTmpJsonl("empty.jsonl", [
      { type: "user", message: { content: "" }, timestamp: "2025-01-01T00:00:00Z" },
      { type: "user", message: { content: [] }, timestamp: "2025-01-01T00:00:01Z" },
    ]);
    const events = parseSession(f, "/test", "test");
    expect(events).toHaveLength(0);
  });

  it("generates content_preview truncated to ~120 chars", () => {
    const longText = "A".repeat(200);
    const f = writeTmpJsonl("preview.jsonl", [
      { type: "user", message: { content: longText }, timestamp: "2025-01-01T00:00:00Z" },
    ]);
    const events = parseSession(f, "/test", "test");
    expect(events[0].content_preview.length).toBeLessThanOrEqual(121); // 120 + "…"
    expect(events[0].content_preview).toContain("…");
  });
});

describe("parseSessionAsync", () => {
  it("produces same results as sync parser", async () => {
    const f = writeTmpJsonl("async.jsonl", [
      { type: "summary", gitBranch: "feat", sessionId: "s1" },
      { type: "user", message: { content: "hello" }, timestamp: "2025-01-01T00:00:00Z" },
      { type: "assistant", message: { content: [{ type: "text", text: "hi" }] }, timestamp: "2025-01-01T00:00:01Z" },
      { type: "user", message: { content: "no, wrong" }, timestamp: "2025-01-01T00:00:02Z" },
    ]);
    const sync = parseSession(f, "/test", "test");
    const async_ = await parseSessionAsync(f, "/test", "test");
    // Async parser doesn't skip summary records in processRecord the same way — 
    // but the event types and counts should match for non-summary records
    expect(async_.map((e) => e.type)).toEqual(sync.map((e) => e.type));
    expect(async_.map((e) => e.content)).toEqual(sync.map((e) => e.content));
  });
});
