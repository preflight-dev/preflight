import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { parseSession, parseSessionAsync, findSessionFiles } from "../../src/lib/session-parser.js";

function tmpDir() {
  return mkdtempSync(join(tmpdir(), "pf-session-test-"));
}

function writeJsonl(dir: string, name: string, records: any[]): string {
  const p = join(dir, name);
  writeFileSync(p, records.map((r) => JSON.stringify(r)).join("\n") + "\n");
  return p;
}

describe("parseSession", () => {
  let dir: string;
  beforeEach(() => { dir = tmpDir(); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it("parses a user prompt into a prompt event", () => {
    const path = writeJsonl(dir, "test.jsonl", [
      { type: "user", message: { content: "Fix the login bug" }, timestamp: "2025-01-01T10:00:00Z" },
    ]);
    const events = parseSession(path, "/proj", "proj");
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("prompt");
    expect(events[0].content).toBe("Fix the login bug");
    expect(events[0].timestamp).toBe("2025-01-01T10:00:00.000Z");
  });

  it("parses assistant text response", () => {
    const path = writeJsonl(dir, "test.jsonl", [
      { type: "assistant", message: { content: [{ type: "text", text: "Done!" }] }, timestamp: "2025-01-01T10:01:00Z" },
    ]);
    const events = parseSession(path, "/proj", "proj");
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("assistant");
    expect(events[0].content).toBe("Done!");
  });

  it("extracts tool_use blocks as tool_call events", () => {
    const path = writeJsonl(dir, "test.jsonl", [
      {
        type: "assistant",
        message: {
          content: [
            { type: "text", text: "Let me check" },
            { type: "tool_use", name: "Read", input: { path: "foo.ts" } },
          ],
        },
        timestamp: "2025-01-01T10:01:00Z",
      },
    ]);
    const events = parseSession(path, "/proj", "proj");
    expect(events).toHaveLength(2);
    expect(events[0].type).toBe("assistant");
    expect(events[1].type).toBe("tool_call");
    expect(events[1].content).toContain("Read");
  });

  it("detects Task/dispatch_agent as sub_agent_spawn", () => {
    const path = writeJsonl(dir, "test.jsonl", [
      {
        type: "assistant",
        message: {
          content: [{ type: "tool_use", name: "Task", input: { description: "refactor" } }],
        },
        timestamp: "2025-01-01T10:01:00Z",
      },
    ]);
    const events = parseSession(path, "/proj", "proj");
    expect(events.some((e) => e.type === "sub_agent_spawn")).toBe(true);
  });

  it("detects correction when user follows assistant with correction words", () => {
    const path = writeJsonl(dir, "test.jsonl", [
      { type: "assistant", message: { content: "Here's the fix" }, timestamp: "2025-01-01T10:00:00Z" },
      { type: "user", message: { content: "No, that's wrong" }, timestamp: "2025-01-01T10:01:00Z" },
    ]);
    const events = parseSession(path, "/proj", "proj");
    const correction = events.find((e) => e.type === "correction");
    expect(correction).toBeDefined();
    expect(correction!.content).toBe("No, that's wrong");
  });

  it("does not mark normal follow-up as correction", () => {
    const path = writeJsonl(dir, "test.jsonl", [
      { type: "assistant", message: { content: "Done" }, timestamp: "2025-01-01T10:00:00Z" },
      { type: "user", message: { content: "Now add tests" }, timestamp: "2025-01-01T10:01:00Z" },
    ]);
    const events = parseSession(path, "/proj", "proj");
    expect(events.every((e) => e.type !== "correction")).toBe(true);
  });

  it("detects tool_result errors", () => {
    const path = writeJsonl(dir, "test.jsonl", [
      { type: "tool_result", is_error: true, content: "Command failed", timestamp: "2025-01-01T10:00:00Z" },
    ]);
    const events = parseSession(path, "/proj", "proj");
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("error");
  });

  it("detects compaction events", () => {
    const path = writeJsonl(dir, "test.jsonl", [
      { type: "system", subtype: "compaction", content: "Context compacted", timestamp: "2025-01-01T10:00:00Z" },
    ]);
    const events = parseSession(path, "/proj", "proj");
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("compaction");
  });

  it("handles summary records for branch/session metadata", () => {
    const path = writeJsonl(dir, "test.jsonl", [
      { type: "summary", gitBranch: "feat/login", sessionId: "abc-123" },
      { type: "user", message: { content: "hello" }, timestamp: "2025-01-01T10:00:00Z" },
    ]);
    const events = parseSession(path, "/proj", "proj");
    expect(events).toHaveLength(1);
    expect(events[0].branch).toBe("feat/login");
    expect(events[0].session_id).toBe("abc-123");
  });

  it("skips malformed JSON lines gracefully", () => {
    const p = join(dir, "bad.jsonl");
    writeFileSync(p, '{"type":"user","message":{"content":"hi"},"timestamp":"2025-01-01T10:00:00Z"}\nnot json\n');
    const events = parseSession(p, "/proj", "proj");
    expect(events).toHaveLength(1);
  });

  it("handles content as array of text blocks", () => {
    const path = writeJsonl(dir, "test.jsonl", [
      {
        type: "user",
        message: { content: [{ type: "text", text: "part1" }, { type: "text", text: "part2" }] },
        timestamp: "2025-01-01T10:00:00Z",
      },
    ]);
    const events = parseSession(path, "/proj", "proj");
    expect(events[0].content).toBe("part1\npart2");
  });

  it("normalizes epoch timestamps", () => {
    const path = writeJsonl(dir, "test.jsonl", [
      { type: "user", message: { content: "hi" }, timestamp: 1704067200 },
    ]);
    const events = parseSession(path, "/proj", "proj");
    expect(events[0].timestamp).toBe("2024-01-01T00:00:00.000Z");
  });

  it("normalizes epoch-ms timestamps", () => {
    const path = writeJsonl(dir, "test.jsonl", [
      { type: "user", message: { content: "hi" }, timestamp: 1704067200000 },
    ]);
    const events = parseSession(path, "/proj", "proj");
    expect(events[0].timestamp).toBe("2024-01-01T00:00:00.000Z");
  });

  it("assigns unique IDs to all events", () => {
    const path = writeJsonl(dir, "test.jsonl", [
      { type: "user", message: { content: "a" }, timestamp: "2025-01-01T10:00:00Z" },
      { type: "user", message: { content: "b" }, timestamp: "2025-01-01T10:01:00Z" },
    ]);
    const events = parseSession(path, "/proj", "proj");
    const ids = new Set(events.map((e) => e.id));
    expect(ids.size).toBe(2);
  });

  it("populates content_preview as truncated first line", () => {
    const longContent = "A".repeat(200);
    const path = writeJsonl(dir, "test.jsonl", [
      { type: "user", message: { content: longContent }, timestamp: "2025-01-01T10:00:00Z" },
    ]);
    const events = parseSession(path, "/proj", "proj");
    expect(events[0].content_preview.length).toBeLessThanOrEqual(121); // 120 + ellipsis
  });
});

describe("parseSessionAsync", () => {
  let dir: string;
  beforeEach(() => { dir = tmpDir(); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it("produces same results as sync parser", async () => {
    const path = writeJsonl(dir, "test.jsonl", [
      { type: "user", message: { content: "hello" }, timestamp: "2025-01-01T10:00:00Z" },
      { type: "assistant", message: { content: "hi" }, timestamp: "2025-01-01T10:00:01Z" },
      { type: "user", message: { content: "no wrong" }, timestamp: "2025-01-01T10:00:02Z" },
    ]);
    const syncEvents = parseSession(path, "/proj", "proj");
    const asyncEvents = await parseSessionAsync(path, "/proj", "proj");
    expect(asyncEvents.map((e) => e.type)).toEqual(syncEvents.map((e) => e.type));
    expect(asyncEvents.map((e) => e.content)).toEqual(syncEvents.map((e) => e.content));
  });
});

describe("findSessionFiles", () => {
  let dir: string;
  beforeEach(() => { dir = tmpDir(); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it("finds .jsonl files in directory", () => {
    writeFileSync(join(dir, "session1.jsonl"), "{}");
    writeFileSync(join(dir, "session2.jsonl"), "{}");
    writeFileSync(join(dir, "readme.txt"), "ignore");
    const files = findSessionFiles(dir);
    expect(files).toHaveLength(2);
    expect(files.every((f) => f.path.endsWith(".jsonl"))).toBe(true);
  });

  it("returns empty for non-existent directory", () => {
    expect(findSessionFiles("/nonexistent/path")).toEqual([]);
  });
});
