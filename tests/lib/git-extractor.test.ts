import { describe, it, expect, vi } from "vitest";
import { parseGitOutput } from "../../src/lib/git-extractor.js";

// Mirrors the delimiters in git-extractor.ts after git processes %% → %
const SEP = "%COMMIT_START%";
const END = "%COMMIT_END%";
const F = "%F%";

function fakeCommitBlock(opts: {
  hash?: string;
  date?: string;
  author?: string;
  subject?: string;
  body?: string;
  stat?: string;
}): string {
  const h = opts.hash ?? "abc1234567890abcdef1234567890abcdef123456";
  const d = opts.date ?? "2026-03-04T12:00:00-07:00";
  const a = opts.author ?? "dev";
  const s = opts.subject ?? "fix: something";
  const b = opts.body ?? "";
  const statBlock = opts.stat ?? " 2 files changed, 10 insertions(+), 3 deletions(-)";
  return `${SEP}${F}${h}${F}${d}${F}${a}${F}${s}${F}${b}${F}${END}\n${statBlock}`;
}

describe("parseGitOutput", () => {
  it("parses a single commit with stat summary", () => {
    const raw = fakeCommitBlock({
      hash: "deadbeef1234567890abcdef1234567890deadbe",
      date: "2026-01-15T09:30:00Z",
      author: "Alice",
      subject: "feat: add widget",
      stat: " src/widget.ts | 42 ++++\n 1 file changed, 42 insertions(+)",
    });

    const events = parseGitOutput(raw, "/proj", "proj");
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("commit");
    expect(events[0].project).toBe("/proj");
    expect(events[0].project_name).toBe("proj");
    expect(events[0].content_preview).toBe("feat: add widget");
    expect(events[0].source_file).toBe("git:deadbeef1234567890abcdef1234567890deadbe");

    const meta = JSON.parse(events[0].metadata);
    expect(meta.author).toBe("Alice");
    expect(meta.files_changed).toBe(1);
    expect(meta.insertions).toBe(42);
    expect(meta.deletions).toBe(0);
  });

  it("parses multiple commits", () => {
    const raw = [
      fakeCommitBlock({ hash: "aaa", subject: "first" }),
      fakeCommitBlock({ hash: "bbb", subject: "second" }),
      fakeCommitBlock({ hash: "ccc", subject: "third" }),
    ].join("\n");

    const events = parseGitOutput(raw, "/p", "p");
    expect(events).toHaveLength(3);
    expect(events.map((e) => e.content_preview)).toEqual(["first", "second", "third"]);
  });

  it("includes body in content when present", () => {
    const raw = fakeCommitBlock({
      subject: "fix: crash on startup",
      body: "The null check was missing for config.timeout",
    });

    const events = parseGitOutput(raw, "/p", "p");
    expect(events[0].content).toContain("fix: crash on startup");
    expect(events[0].content).toContain("The null check was missing");
  });

  it("handles commit with no stat summary", () => {
    const raw = `${SEP}${F}abc123${F}2026-01-01T00:00:00Z${F}dev${F}initial commit${F}${F}${END}`;

    const events = parseGitOutput(raw, "/p", "p");
    expect(events).toHaveLength(1);
    const meta = JSON.parse(events[0].metadata);
    expect(meta.files_changed).toBe(0);
    expect(meta.insertions).toBe(0);
    expect(meta.deletions).toBe(0);
  });

  it("handles stat with deletions only", () => {
    const raw = fakeCommitBlock({
      stat: " 5 files changed, 100 deletions(-)",
    });

    const events = parseGitOutput(raw, "/p", "p");
    const meta = JSON.parse(events[0].metadata);
    expect(meta.files_changed).toBe(5);
    expect(meta.insertions).toBe(0);
    expect(meta.deletions).toBe(100);
  });

  it("handles stat with insertions and deletions", () => {
    const raw = fakeCommitBlock({
      stat: " 3 files changed, 20 insertions(+), 8 deletions(-)",
    });

    const events = parseGitOutput(raw, "/p", "p");
    const meta = JSON.parse(events[0].metadata);
    expect(meta.files_changed).toBe(3);
    expect(meta.insertions).toBe(20);
    expect(meta.deletions).toBe(8);
  });

  it("truncates long subjects in content_preview", () => {
    const longSubject = "x".repeat(200);
    const raw = fakeCommitBlock({ subject: longSubject });

    const events = parseGitOutput(raw, "/p", "p");
    expect(events[0].content_preview.length).toBeLessThanOrEqual(121); // 120 + "…"
    expect(events[0].content_preview).toMatch(/…$/);
  });

  it("returns empty array for empty input", () => {
    expect(parseGitOutput("", "/p", "p")).toEqual([]);
    expect(parseGitOutput("   \n  ", "/p", "p")).toEqual([]);
  });

  it("skips blocks with missing hash", () => {
    const raw = `${SEP}${F}${F}2026-01-01T00:00:00Z${F}dev${F}no hash${F}${F}${END}`;
    const events = parseGitOutput(raw, "/p", "p");
    expect(events).toHaveLength(0);
  });

  it("skips malformed blocks without crashing", () => {
    const raw = `${SEP}garbage without end marker\n${fakeCommitBlock({ hash: "good", subject: "valid" })}`;
    // The garbage block lacks COMMIT_END so it's filtered out by the split+filter
    const events = parseGitOutput(raw, "/p", "p");
    expect(events).toHaveLength(1);
    expect(events[0].content_preview).toBe("valid");
  });

  it("generates unique ids for each event", () => {
    const raw = [
      fakeCommitBlock({ hash: "a1" }),
      fakeCommitBlock({ hash: "b2" }),
    ].join("\n");

    const events = parseGitOutput(raw, "/p", "p");
    expect(events[0].id).not.toBe(events[1].id);
    // UUIDs should be valid format
    expect(events[0].id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("preserves ISO timestamp from git", () => {
    const raw = fakeCommitBlock({ date: "2026-06-15T14:30:00+05:30" });
    const events = parseGitOutput(raw, "/p", "p");
    // Should be converted to ISO string
    expect(events[0].timestamp).toBe(new Date("2026-06-15T14:30:00+05:30").toISOString());
  });
});
