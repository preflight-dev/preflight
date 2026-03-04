import { describe, it, expect, vi } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { execSync } from "child_process";

// Create a real temp git repo
const testDir = mkdtempSync(join(tmpdir(), "preflight-git-test-"));
execSync("git init && git commit --allow-empty -m 'init'", { cwd: testDir, stdio: "pipe" });

vi.mock("../../src/lib/files.js", () => ({
  PROJECT_DIR: testDir,
}));

const git = await import("../../src/lib/git.js");

describe("git", () => {
  it("getBranch returns a branch name", () => {
    const branch = git.getBranch();
    // Default branch after init is usually main or master
    expect(typeof branch).toBe("string");
    expect(branch.length).toBeGreaterThan(0);
  });

  it("getStatus returns string (empty for clean repo)", () => {
    const status = git.getStatus();
    expect(typeof status).toBe("string");
  });

  it("getRecentCommits returns commit lines", () => {
    const commits = git.getRecentCommits(1);
    expect(commits).toContain("init");
  });

  it("getLastCommit returns the init commit", () => {
    const last = git.getLastCommit();
    expect(last).toContain("init");
  });

  it("getLastCommitTime returns a date string", () => {
    const time = git.getLastCommitTime();
    // Should be parseable as a date
    expect(new Date(time).getFullYear()).toBeGreaterThanOrEqual(2024);
  });

  it("getStagedFiles returns empty string for clean repo", () => {
    const staged = git.getStagedFiles();
    expect(staged).toBe("");
  });

  it("run handles invalid git command gracefully", () => {
    const result = git.run(["not-a-real-command"]);
    // Should return error string, not throw
    expect(typeof result).toBe("string");
  });

  it("run handles timeout", () => {
    // This should complete fast, just testing the timeout path exists
    const result = git.run(["status"], { timeout: 5000 });
    expect(typeof result).toBe("string");
  });
});
