import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as child_process from "child_process";

// Mock child_process
vi.mock("child_process", () => ({
  execFileSync: vi.fn(),
}));

// Mock files module to control PROJECT_DIR
vi.mock("../../src/lib/files.js", () => ({
  PROJECT_DIR: "/tmp/fake-project",
}));

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

const mockedExecFileSync = vi.mocked(child_process.execFileSync);

describe("git lib", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("run", () => {
    it("executes git with array args and returns trimmed stdout", () => {
      mockedExecFileSync.mockReturnValue("  main  \n" as any);
      const result = run(["branch", "--show-current"]);
      expect(result).toBe("main");
      expect(mockedExecFileSync).toHaveBeenCalledWith(
        "git",
        ["branch", "--show-current"],
        expect.objectContaining({ cwd: "/tmp/fake-project", encoding: "utf-8" })
      );
    });

    it("splits string args on whitespace", () => {
      mockedExecFileSync.mockReturnValue("ok" as any);
      run("status --short");
      expect(mockedExecFileSync).toHaveBeenCalledWith(
        "git",
        ["status", "--short"],
        expect.any(Object)
      );
    });

    it("returns timeout message when process is killed", () => {
      const err: any = new Error("timed out");
      err.killed = true;
      mockedExecFileSync.mockImplementation(() => { throw err; });
      expect(run(["log"])).toMatch(/timed out/);
    });

    it("returns stderr on command failure", () => {
      const err: any = new Error("failed");
      err.stdout = "";
      err.stderr = "fatal: not a git repository";
      mockedExecFileSync.mockImplementation(() => { throw err; });
      expect(run(["status"])).toBe("fatal: not a git repository");
    });

    it("returns ENOENT message when git is not found", () => {
      const err: any = new Error("not found");
      err.code = "ENOENT";
      err.stdout = "";
      err.stderr = "";
      mockedExecFileSync.mockImplementation(() => { throw err; });
      expect(run(["status"])).toBe("[git not found]");
    });

    it("returns generic failure message when no output available", () => {
      const err: any = new Error("boom");
      err.stdout = "";
      err.stderr = "";
      err.status = 128;
      mockedExecFileSync.mockImplementation(() => { throw err; });
      expect(run(["bad-cmd"])).toBe("[command failed: git bad-cmd (exit 128)]");
    });

    it("respects custom timeout option", () => {
      mockedExecFileSync.mockReturnValue("ok" as any);
      run(["log"], { timeout: 5000 });
      expect(mockedExecFileSync).toHaveBeenCalledWith(
        "git",
        ["log"],
        expect.objectContaining({ timeout: 5000 })
      );
    });
  });

  describe("convenience functions", () => {
    it("getBranch calls git branch --show-current", () => {
      mockedExecFileSync.mockReturnValue("feature/test\n" as any);
      expect(getBranch()).toBe("feature/test");
    });

    it("getStatus calls git status --short", () => {
      mockedExecFileSync.mockReturnValue("M src/index.ts\n" as any);
      expect(getStatus()).toBe("M src/index.ts");
    });

    it("getRecentCommits defaults to 5", () => {
      mockedExecFileSync.mockReturnValue("abc123 first\ndef456 second" as any);
      const result = getRecentCommits();
      expect(result).toBe("abc123 first\ndef456 second");
      expect(mockedExecFileSync).toHaveBeenCalledWith(
        "git",
        ["log", "--oneline", "-5"],
        expect.any(Object)
      );
    });

    it("getRecentCommits accepts custom count", () => {
      mockedExecFileSync.mockReturnValue("abc123 first" as any);
      getRecentCommits(3);
      expect(mockedExecFileSync).toHaveBeenCalledWith(
        "git",
        ["log", "--oneline", "-3"],
        expect.any(Object)
      );
    });

    it("getLastCommit returns single line", () => {
      mockedExecFileSync.mockReturnValue("abc123 fix bug\n" as any);
      expect(getLastCommit()).toBe("abc123 fix bug");
    });

    it("getLastCommitTime returns timestamp", () => {
      mockedExecFileSync.mockReturnValue("2026-03-15 14:00:00 -0700\n" as any);
      expect(getLastCommitTime()).toBe("2026-03-15 14:00:00 -0700");
    });

    it("getStagedFiles returns staged file list", () => {
      mockedExecFileSync.mockReturnValue("src/index.ts\nsrc/lib/git.ts" as any);
      expect(getStagedFiles()).toBe("src/index.ts\nsrc/lib/git.ts");
    });
  });

  describe("getDiffFiles", () => {
    it("returns diff output on success", () => {
      mockedExecFileSync.mockReturnValue("src/index.ts\nsrc/lib/git.ts" as any);
      expect(getDiffFiles("HEAD~3")).toBe("src/index.ts\nsrc/lib/git.ts");
    });

    it("falls back to HEAD~1 when ref fails", () => {
      let callCount = 0;
      mockedExecFileSync.mockImplementation((_cmd, args: any) => {
        callCount++;
        if (callCount === 1) {
          // First call fails
          const err: any = new Error("bad ref");
          err.stdout = "";
          err.stderr = "[command failed]";
          throw err;
        }
        return "fallback.ts" as any;
      });
      expect(getDiffFiles("nonexistent")).toBe("fallback.ts");
    });

    it("returns 'no commits' when both refs fail", () => {
      mockedExecFileSync.mockImplementation(() => {
        const err: any = new Error("fail");
        err.stdout = "";
        err.stderr = "[bad]";
        throw err;
      });
      expect(getDiffFiles()).toBe("no commits");
    });
  });

  describe("getDiffStat", () => {
    it("returns stat output on success", () => {
      mockedExecFileSync.mockReturnValue(" 3 files changed, 10 insertions(+)" as any);
      expect(getDiffStat()).toBe("3 files changed, 10 insertions(+)");
    });

    it("falls back to HEAD~3 when default ref fails", () => {
      let callCount = 0;
      mockedExecFileSync.mockImplementation((_cmd, args: any) => {
        callCount++;
        if (callCount === 1) {
          const err: any = new Error("bad");
          err.stdout = "";
          err.stderr = "[nope]";
          throw err;
        }
        return "1 file changed" as any;
      });
      expect(getDiffStat()).toBe("1 file changed");
    });

    it("returns fallback message when both fail", () => {
      mockedExecFileSync.mockImplementation(() => {
        const err: any = new Error("fail");
        err.stdout = "";
        err.stderr = "[bad]";
        throw err;
      });
      expect(getDiffStat()).toBe("no diff stats available");
    });
  });
});
