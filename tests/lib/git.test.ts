import { describe, it, expect, vi, beforeEach } from "vitest";
import * as child_process from "child_process";

// Mock execFileSync before importing the module
vi.mock("child_process", () => ({
  execFileSync: vi.fn(),
}));

// Mock files module to avoid PROJECT_DIR issues
vi.mock("../../src/lib/files.js", () => ({
  PROJECT_DIR: "/tmp/test-project",
}));

// Import after mocks are set up
const { run, getBranch, getStatus, getRecentCommits, getLastCommit, getLastCommitTime, getDiffFiles, getStagedFiles, getDiffStat } = await import("../../src/lib/git.js");

const mockExecFileSync = vi.mocked(child_process.execFileSync);

describe("lib/git", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("run()", () => {
    it("accepts an array of args", () => {
      mockExecFileSync.mockReturnValue("ok\n");
      const result = run(["status", "--short"]);
      expect(result).toBe("ok");
      expect(mockExecFileSync).toHaveBeenCalledWith("git", ["status", "--short"], expect.objectContaining({
        cwd: "/tmp/test-project",
        encoding: "utf-8",
      }));
    });

    it("splits string args on whitespace", () => {
      mockExecFileSync.mockReturnValue("ok\n");
      run("log --oneline -5");
      expect(mockExecFileSync).toHaveBeenCalledWith("git", ["log", "--oneline", "-5"], expect.any(Object));
    });

    it("trims output", () => {
      mockExecFileSync.mockReturnValue("  hello world  \n");
      expect(run(["status"])).toBe("hello world");
    });

    it("returns timeout message when process is killed", () => {
      const err: any = new Error("killed");
      err.killed = true;
      mockExecFileSync.mockImplementation(() => { throw err; });
      expect(run(["log"])).toBe("[timed out after 10000ms]");
    });

    it("returns timeout message with custom timeout", () => {
      const err: any = new Error("killed");
      err.signal = "SIGTERM";
      mockExecFileSync.mockImplementation(() => { throw err; });
      expect(run(["log"], { timeout: 5000 })).toBe("[timed out after 5000ms]");
    });

    it("returns stderr on command failure", () => {
      const err: any = new Error("fail");
      err.stderr = "fatal: not a git repo\n";
      err.stdout = "";
      mockExecFileSync.mockImplementation(() => { throw err; });
      expect(run(["status"])).toBe("fatal: not a git repo");
    });

    it("returns stdout on failure if stderr empty", () => {
      const err: any = new Error("fail");
      err.stderr = "";
      err.stdout = "partial output\n";
      mockExecFileSync.mockImplementation(() => { throw err; });
      expect(run(["diff"])).toBe("partial output");
    });

    it("returns ENOENT message when git not found", () => {
      const err: any = new Error("not found");
      err.code = "ENOENT";
      err.stdout = "";
      err.stderr = "";
      mockExecFileSync.mockImplementation(() => { throw err; });
      expect(run(["status"])).toBe("[git not found]");
    });

    it("returns generic failure message when no output available", () => {
      const err: any = new Error("fail");
      err.status = 128;
      err.stdout = "";
      err.stderr = "";
      mockExecFileSync.mockImplementation(() => { throw err; });
      expect(run(["push"])).toBe("[command failed: git push (exit 128)]");
    });

    it("respects custom timeout option", () => {
      mockExecFileSync.mockReturnValue("ok");
      run(["status"], { timeout: 5000 });
      expect(mockExecFileSync).toHaveBeenCalledWith("git", ["status"], expect.objectContaining({
        timeout: 5000,
      }));
    });
  });

  describe("convenience functions", () => {
    it("getBranch calls branch --show-current", () => {
      mockExecFileSync.mockReturnValue("main\n");
      expect(getBranch()).toBe("main");
      expect(mockExecFileSync).toHaveBeenCalledWith("git", ["branch", "--show-current"], expect.any(Object));
    });

    it("getStatus calls status --short", () => {
      mockExecFileSync.mockReturnValue("M src/index.ts\n");
      expect(getStatus()).toBe("M src/index.ts");
    });

    it("getRecentCommits defaults to 5", () => {
      mockExecFileSync.mockReturnValue("abc123 commit msg\n");
      getRecentCommits();
      expect(mockExecFileSync).toHaveBeenCalledWith("git", ["log", "--oneline", "-5"], expect.any(Object));
    });

    it("getRecentCommits accepts custom count", () => {
      mockExecFileSync.mockReturnValue("abc123 commit msg\n");
      getRecentCommits(10);
      expect(mockExecFileSync).toHaveBeenCalledWith("git", ["log", "--oneline", "-10"], expect.any(Object));
    });

    it("getLastCommit returns single oneline commit", () => {
      mockExecFileSync.mockReturnValue("abc123 fix bug\n");
      expect(getLastCommit()).toBe("abc123 fix bug");
    });

    it("getLastCommitTime returns formatted time", () => {
      mockExecFileSync.mockReturnValue("2026-03-09 08:00:00 -0700\n");
      expect(getLastCommitTime()).toBe("2026-03-09 08:00:00 -0700");
    });

    it("getStagedFiles calls diff --staged --name-only", () => {
      mockExecFileSync.mockReturnValue("src/index.ts\n");
      expect(getStagedFiles()).toBe("src/index.ts");
    });
  });

  describe("getDiffFiles()", () => {
    it("returns diff files for given ref", () => {
      mockExecFileSync.mockReturnValue("src/a.ts\nsrc/b.ts\n");
      expect(getDiffFiles("HEAD~5")).toBe("src/a.ts\nsrc/b.ts");
    });

    it("falls back to HEAD~1 on error", () => {
      mockExecFileSync
        .mockReturnValueOnce("[command failed: git diff (exit 128)]" as any)
        .mockReturnValueOnce("src/c.ts\n");
      // First call fails (starts with "["), second succeeds
      // But run() catches errors internally, so we need to mock differently
      const err: any = new Error("fail");
      err.status = 128;
      err.stdout = "";
      err.stderr = "";
      mockExecFileSync.mockReset();
      mockExecFileSync
        .mockImplementationOnce(() => { throw err; })
        .mockReturnValueOnce("src/fallback.ts\n");
      expect(getDiffFiles("HEAD~3")).toBe("src/fallback.ts");
    });

    it("returns 'no commits' when both attempts fail", () => {
      const err: any = new Error("fail");
      err.status = 128;
      err.stdout = "";
      err.stderr = "";
      mockExecFileSync.mockImplementation(() => { throw err; });
      expect(getDiffFiles()).toBe("no commits");
    });
  });

  describe("getDiffStat()", () => {
    it("returns diff stat for given ref", () => {
      mockExecFileSync.mockReturnValue(" 2 files changed, 10 insertions(+)\n");
      expect(getDiffStat("HEAD~2")).toBe("2 files changed, 10 insertions(+)");
    });

    it("falls back to HEAD~3 on error", () => {
      const err: any = new Error("fail");
      err.status = 128;
      err.stdout = "";
      err.stderr = "";
      mockExecFileSync
        .mockImplementationOnce(() => { throw err; })
        .mockReturnValueOnce(" 1 file changed\n");
      expect(getDiffStat()).toBe("1 file changed");
    });

    it("returns fallback message when both fail", () => {
      const err: any = new Error("fail");
      err.status = 128;
      err.stdout = "";
      err.stderr = "";
      mockExecFileSync.mockImplementation(() => { throw err; });
      expect(getDiffStat()).toBe("no diff stats available");
    });
  });
});
