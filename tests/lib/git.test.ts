import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { execFileSync } from "child_process";
import { mkdtempSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

// We need to mock PROJECT_DIR before importing git functions
let tempDir: string;

beforeAll(() => {
  tempDir = mkdtempSync(join(tmpdir(), "preflight-git-test-"));

  // Initialize a git repo with a couple of commits
  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd: tempDir, encoding: "utf-8" });

  git("init");
  git("config", "user.email", "test@test.com");
  git("config", "user.name", "Test");

  writeFileSync(join(tempDir, "file1.ts"), "export const a = 1;\n");
  git("add", ".");
  git("commit", "-m", "initial commit");

  writeFileSync(join(tempDir, "file2.ts"), "export const b = 2;\n");
  git("add", ".");
  git("commit", "-m", "second commit");
});

afterAll(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

// Mock PROJECT_DIR to point to our temp repo
vi.mock("../../src/lib/files.js", () => ({
  get PROJECT_DIR() {
    return tempDir;
  },
}));

// Import after mock setup (vitest hoists vi.mock, so this works)
import {
  run,
  getBranch,
  getStatus,
  getRecentCommits,
  getLastCommit,
  getLastCommitTime,
  getDiffFiles,
  getStagedFiles,
  getDiffStat,
} from "../../src/lib/git.js";

describe("git.run()", () => {
  it("accepts array args", () => {
    const result = run(["log", "--oneline", "-1"]);
    expect(result).toContain("second commit");
  });

  it("accepts string args (split on whitespace)", () => {
    const result = run("log --oneline -1");
    expect(result).toContain("second commit");
  });

  it("returns error string on invalid command (no throw)", () => {
    const result = run(["log", "--invalid-flag-xyz"]);
    expect(result).toMatch(/\[command failed|unknown option|unrecognized/i);
  });

  it("does NOT interpret shell syntax (no injection)", () => {
    // If shell were used, this would try to pipe. With execFileSync it's a literal arg.
    const result = run(["log", "--oneline", "-1", "| cat"]);
    // Should fail or return an error, not execute "cat"
    expect(result.startsWith("[") || result.includes("fatal") || result === "").toBe(true);
  });
});

describe("getBranch()", () => {
  it("returns current branch name", () => {
    const branch = getBranch();
    // Default branch varies (main/master), just check it's non-empty
    expect(branch.length).toBeGreaterThan(0);
  });
});

describe("getStatus()", () => {
  it("returns empty string for clean working tree", () => {
    const status = getStatus();
    expect(status).toBe("");
  });

  it("shows modified files", () => {
    writeFileSync(join(tempDir, "file1.ts"), "export const a = 42;\n");
    const status = getStatus();
    expect(status).toContain("file1.ts");
    // Restore
    execFileSync("git", ["checkout", "--", "file1.ts"], { cwd: tempDir });
  });
});

describe("getRecentCommits()", () => {
  it("returns requested number of commits", () => {
    const commits = getRecentCommits(2);
    const lines = commits.split("\n").filter(Boolean);
    expect(lines).toHaveLength(2);
  });

  it("defaults to 5 (returns available)", () => {
    const commits = getRecentCommits();
    const lines = commits.split("\n").filter(Boolean);
    // We only have 2 commits, so should return 2
    expect(lines.length).toBeLessThanOrEqual(5);
    expect(lines.length).toBeGreaterThanOrEqual(1);
  });
});

describe("getLastCommit()", () => {
  it("returns single line with commit message", () => {
    const commit = getLastCommit();
    expect(commit).toContain("second commit");
    expect(commit.split("\n")).toHaveLength(1);
  });
});

describe("getLastCommitTime()", () => {
  it("returns ISO-ish timestamp", () => {
    const time = getLastCommitTime();
    // Format: 2026-03-09 12:00:00 -0700
    expect(time).toMatch(/\d{4}-\d{2}-\d{2}/);
  });
});

describe("getDiffFiles()", () => {
  it("returns changed files since ref", () => {
    const files = getDiffFiles("HEAD~1");
    expect(files).toContain("file2.ts");
  });

  it("falls back gracefully for invalid ref", () => {
    const result = getDiffFiles("nonexistent-ref");
    // Should fall back to HEAD~1 or return "no commits"
    expect(typeof result).toBe("string");
  });
});

describe("getStagedFiles()", () => {
  it("returns empty for no staged changes", () => {
    const staged = getStagedFiles();
    expect(staged).toBe("");
  });
});

describe("getDiffStat()", () => {
  it("returns stat output for valid ref", () => {
    const stat = getDiffStat("HEAD~1");
    expect(stat).toContain("file2.ts");
    // Stat output includes insertions/deletions
    expect(stat).toMatch(/\d+ insertion|changed/);
  });
});
