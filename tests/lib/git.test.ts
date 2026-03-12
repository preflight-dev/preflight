import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as cp from "child_process";

// Mock child_process
vi.mock("child_process", () => ({
  execFileSync: vi.fn(),
  execSync: vi.fn(),
}));

// Mock files module to provide PROJECT_DIR
vi.mock("../../src/lib/files.js", () => ({
  PROJECT_DIR: "/mock/project",
}));

import { run, shell, getBranch, getStatus, getRecentCommits, getLastCommit, getLastCommitTime, getDiffFiles, getStagedFiles, getDiffStat } from "../../src/lib/git.js";

const mockedExecFileSync = vi.mocked(cp.execFileSync);
const mockedExecSync = vi.mocked(cp.execSync);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("run()", () => {
  it("accepts an array of args and calls execFileSync with git", () => {
    mockedExecFileSync.mockReturnValue("output\n" as any);
    const result = run(["status", "--short"]);
    expect(mockedExecFileSync).toHaveBeenCalledWith("git", ["status", "--short"], expect.objectContaining({ cwd: "/mock/project" }));
    expect(result).toBe("output");
  });

  it("accepts a string and splits on whitespace", () => {
    mockedExecFileSync.mockReturnValue("ok\n" as any);
    run("log --oneline -5");
    expect(mockedExecFileSync).toHaveBeenCalledWith("git", ["log", "--oneline", "-5"], expect.any(Object));
  });

  it("returns timeout message when process is killed", () => {
    const err = new Error("timed out") as any;
    err.killed = true;
    mockedExecFileSync.mockImplementation(() => { throw err; });
    expect(run(["status"])).toMatch(/timed out/);
  });

  it("returns stderr on failure", () => {
    const err = new Error("fail") as any;
    err.stderr = "fatal: not a git repo\n";
    err.stdout = "";
    err.status = 128;
    mockedExecFileSync.mockImplementation(() => { throw err; });
    expect(run(["status"])).toBe("fatal: not a git repo");
  });

  it("returns ENOENT message when git is not found", () => {
    const err = new Error("fail") as any;
    err.code = "ENOENT";
    err.stdout = "";
    err.stderr = "";
    mockedExecFileSync.mockImplementation(() => { throw err; });
    expect(run(["status"])).toBe("[git not found]");
  });

  it("returns generic failure message when no output", () => {
    const err = new Error("fail") as any;
    err.status = 1;
    err.stdout = "";
    err.stderr = "";
    mockedExecFileSync.mockImplementation(() => { throw err; });
    expect(run(["bad-cmd"])).toMatch(/command failed/);
  });
});

describe("shell()", () => {
  it("runs arbitrary command via execSync", () => {
    mockedExecSync.mockReturnValue("hello\n" as any);
    const result = shell("echo hello");
    expect(mockedExecSync).toHaveBeenCalledWith("echo hello", expect.objectContaining({ cwd: "/mock/project" }));
    expect(result).toBe("hello");
  });

  it("returns empty string on failure", () => {
    mockedExecSync.mockImplementation(() => { throw new Error("boom"); });
    expect(shell("bad-cmd")).toBe("");
  });

  it("respects custom timeout", () => {
    mockedExecSync.mockReturnValue("" as any);
    shell("slow-cmd", { timeout: 30000 });
    expect(mockedExecSync).toHaveBeenCalledWith("slow-cmd", expect.objectContaining({ timeout: 30000 }));
  });
});

describe("convenience functions", () => {
  it("getBranch calls git branch --show-current", () => {
    mockedExecFileSync.mockReturnValue("main\n" as any);
    expect(getBranch()).toBe("main");
    expect(mockedExecFileSync).toHaveBeenCalledWith("git", ["branch", "--show-current"], expect.any(Object));
  });

  it("getStatus calls git status --short", () => {
    mockedExecFileSync.mockReturnValue("M file.ts\n" as any);
    expect(getStatus()).toBe("M file.ts");
  });

  it("getRecentCommits defaults to 5", () => {
    mockedExecFileSync.mockReturnValue("abc123 msg\n" as any);
    getRecentCommits();
    expect(mockedExecFileSync).toHaveBeenCalledWith("git", ["log", "--oneline", "-5"], expect.any(Object));
  });

  it("getRecentCommits accepts custom count", () => {
    mockedExecFileSync.mockReturnValue("" as any);
    getRecentCommits(10);
    expect(mockedExecFileSync).toHaveBeenCalledWith("git", ["log", "--oneline", "-10"], expect.any(Object));
  });

  it("getLastCommit returns single line", () => {
    mockedExecFileSync.mockReturnValue("abc123 fix stuff\n" as any);
    expect(getLastCommit()).toBe("abc123 fix stuff");
  });

  it("getLastCommitTime returns timestamp", () => {
    mockedExecFileSync.mockReturnValue("2026-03-12 10:00:00 -0700\n" as any);
    expect(getLastCommitTime()).toBe("2026-03-12 10:00:00 -0700");
  });

  it("getStagedFiles returns staged file list", () => {
    mockedExecFileSync.mockReturnValue("src/index.ts\nsrc/lib/git.ts\n" as any);
    expect(getStagedFiles()).toBe("src/index.ts\nsrc/lib/git.ts");
  });
});

describe("getDiffFiles()", () => {
  it("returns diff output on success", () => {
    mockedExecFileSync.mockReturnValue("file1.ts\nfile2.ts\n" as any);
    expect(getDiffFiles()).toBe("file1.ts\nfile2.ts");
  });

  it("falls back to HEAD~1 when default ref fails", () => {
    mockedExecFileSync
      .mockReturnValueOnce("[command failed: ...]" as any)
      .mockReturnValueOnce("fallback.ts\n" as any);
    expect(getDiffFiles()).toBe("fallback.ts");
  });

  it("returns 'no commits' when both refs fail", () => {
    mockedExecFileSync
      .mockReturnValueOnce("[command failed]" as any)
      .mockReturnValueOnce("[command failed]" as any);
    expect(getDiffFiles()).toBe("no commits");
  });
});

describe("getDiffStat()", () => {
  it("returns diff stat on success", () => {
    mockedExecFileSync.mockReturnValue(" 2 files changed, 10 insertions(+)\n" as any);
    expect(getDiffStat()).toBe("2 files changed, 10 insertions(+)");
  });

  it("falls back to HEAD~3 when default ref fails", () => {
    mockedExecFileSync
      .mockReturnValueOnce("[command failed]" as any)
      .mockReturnValueOnce("1 file changed\n" as any);
    expect(getDiffStat()).toBe("1 file changed");
  });

  it("returns fallback message when both fail", () => {
    mockedExecFileSync
      .mockReturnValueOnce("[command failed]" as any)
      .mockReturnValueOnce("[command failed]" as any);
    expect(getDiffStat()).toBe("no diff stats available");
  });
});
