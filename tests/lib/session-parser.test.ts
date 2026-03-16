import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { writeFileSync, mkdirSync, rmSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
  parseSession,
  findSessionFiles,
} from "../../src/lib/session-parser.js";

const TEST_DIR = join(tmpdir(), `preflight-test-${Date.now()}`);

function writeJsonl(name: string, records: any[]): string {
  const dir = join(TEST_DIR, "sessions");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const path = join(dir, name);
  writeFileSync(path, records.map((r) => JSON.stringify(r)).join("\n") + "\n");
  return path;
}

beforeEach(() => mkdirSync(TEST_DIR, { recursive: true }));
afterEach(() => rmSync(TEST_DIR, { recursive: true, force: true }));

describe("parseSession", () => {
  it("parses user prompts into prompt events", () => {
    const path = writeJsonl("test1.jsonl", [
      { type: "summary", sessionId: "s1", gitBranch: "main" },
      { type: "user", timestamp: "2025-01-01T00:00:00Z", message: { content: "add a login page" } },
    ]);
    const events = parseSession(path, "/test", "test");
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("prompt");
    expect(events[0].content).toBe("add a login page");
    expect(events[0].session_id).toBe("s1");
    expect(events[0].branch).toBe("main");
  });

  it("detects corrections after assistant messages", () => {
    const path = writeJsonl("test2.jsonl", [
      { type: "summary", sessionId: "s2", gitBranch: "feat" },
      { type: "user", timestamp: "2025-01-01T00:00:00Z", message: { content: "build the form" } },
      { type: "assistant", timestamp: "2025-01-01T00:00:01Z", message: { content: "Here is the form..." } },
      { type: "user", timestamp: "2025-01-01T00:00:02Z", message: { content: "no, I meant a different form" } },
    ]);
    const events = parseSession(path, "/test", "test");
    expect(events.find((e) => e.type === "correction")).toBeDefined();
  });

  it("extracts tool_call events from assistant content blocks", () => {
    const path = writeJsonl("test3.jsonl", [
      { type: "summary", sessionId: "s3" },
      {
        type: "assistant", timestamp: "2025-01-01T00:00:00Z",
        message: { content: [
          { type: "text", text: "Let me read that file." },
          { type: "tool_use", name: "Read", input: { path: "src/app.ts" } },
        ]},
      },
    ]);
    const events = parseSession(path, "/test", "test");
    expect(events.find((e) => e.type === "assistant")).toBeDefined();
    expect(events.find((e) => e.type === "tool_call")).toBeDefined();
  });

  it("identifies sub_agent_spawn for Task tool", () => {
    const path = writeJsonl("test4.jsonl", [
      {
        type: "assistant", timestamp: "2025-01-01T00:00:00Z",
        message: { content: [{ type: "tool_use", name: "Task", input: { prompt: "run tests" } }] },
      },
    ]);
    const events = parseSession(path, "/test", "test");
    expect(events.some((e) => e.type === "sub_agent_spawn")).toBe(true);
  });

  it("detects errors from tool_result with is_error", () => {
    const path = writeJsonl("test5.jsonl", [
      { type: "tool_result", timestamp: "2025-01-01T00:00:00Z", is_error: true, content: "Command failed: exit code 1" },
    ]);
    const events = parseSession(path, "/test", "test");
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("error");
  });

  it("detects compaction events", () => {
    const path = writeJsonl("test6.jsonl", [
      { type: "system", timestamp: "2025-01-01T00:00:00Z", subtype: "compaction", message: { content: "Context compacted" } },
    ]);
    const events = parseSession(path, "/test", "test");
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("compaction");
  });

  it("handles malformed JSON lines gracefully", () => {
    const dir = join(TEST_DIR, "sessions");
    mkdirSync(dir, { recursive: true });
    const path = join(dir, "bad.jsonl");
    writeFileSync(path, '{"type":"user","message":{"content":"hello"}}\n{broken\n{"type":"user","message":{"content":"world"}}\n');
    const events = parseSession(path, "/test", "test");
    expect(events).toHaveLength(2);
  });

  it("skips empty content", () => {
    const path = writeJsonl("empty.jsonl", [
      { type: "user", timestamp: "2025-01-01T00:00:00Z", message: { content: "" } },
      { type: "user", timestamp: "2025-01-01T00:00:01Z", message: { content: "real prompt" } },
    ]);
    const events = parseSession(path, "/test", "test");
    expect(events).toHaveLength(1);
    expect(events[0].content).toBe("real prompt");
  });

  it("merges array content blocks", () => {
    const path = writeJsonl("blocks.jsonl", [
      {
        type: "user", timestamp: "2025-01-01T00:00:00Z",
        message: { content: [{ type: "text", text: "part one" }, { type: "image", source: {} }, { type: "text", text: "part two" }] },
      },
    ]);
    const events = parseSession(path, "/test", "test");
    expect(events).toHaveLength(1);
    expect(events[0].content).toBe("part one\npart two");
  });

  it("normalizes epoch timestamps", () => {
    const path = writeJsonl("epoch.jsonl", [
      { type: "user", timestamp: 1704067200, message: { content: "epoch test" } },
    ]);
    const events = parseSession(path, "/test", "test");
    expect(events[0].timestamp).toBe("2024-01-01T00:00:00.000Z");
  });

  const corrections = ["no, use the other one", "wrong approach", "not that", "I meant the API", "actually, change it", "instead do X", "undo that"];
  it.each(corrections)("detects correction: '%s'", (phrase) => {
    const path = writeJsonl(`corr-${Math.random()}.jsonl`, [
      { type: "assistant", timestamp: "2025-01-01T00:00:00Z", message: { content: "Done." } },
      { type: "user", timestamp: "2025-01-01T00:00:01Z", message: { content: phrase } },
    ]);
    const events = parseSession(path, "/test", "test");
    expect(events.map((e) => e.type)).toContain("correction");
  });
});

describe("findSessionFiles", () => {
  it("finds .jsonl files in a directory", () => {
    const dir = join(TEST_DIR, "project");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "s1.jsonl"), "{}");
    writeFileSync(join(dir, "s2.jsonl"), "{}");
    writeFileSync(join(dir, "readme.txt"), "nope");
    const files = findSessionFiles(dir);
    expect(files).toHaveLength(2);
  });

  it("finds subagent session files", () => {
    const dir = join(TEST_DIR, "project2");
    const subDir = join(dir, "main-session", "subagents");
    mkdirSync(subDir, { recursive: true });
    writeFileSync(join(dir, "main.jsonl"), "{}");
    writeFileSync(join(subDir, "sub1.jsonl"), "{}");
    const files = findSessionFiles(dir);
    expect(files.length).toBeGreaterThanOrEqual(2);
    expect(files.some((f) => f.sessionId === "sub1")).toBe(true);
  });

  it("returns empty for nonexistent directory", () => {
    expect(findSessionFiles("/nonexistent/path")).toEqual([]);
  });
});
