import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as child_process from "child_process";

// Mock execFileSync before importing git module
vi.mock("child_process", () => ({
  execFileSync: vi.fn(),
}));

vi.mock("../../src/lib/files.js", () => ({
  PROJECT_DIR: "/fake/project",
}));

// Now import the module under test
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

const mockExecFileSync = vi.mocked(child_process.execFileSync);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("run()", () => {
  it("accepts an array of args and returns trimmed stdout", () => {
    mockExecFileSync.mockReturnValue("  result  \n");
    const result = run(["log", "--oneline", "-5"]);
    expect(result).toBe("result");
    expect(mockExecFileSync).toHaveBeenCalledWith(
      "git",
      ["log", "--oneline", "-5"],
      expect.objectContaining({ cwd: "/fake/project", encoding: "utf-8" })
    );
  });

  it("splits a string command on whitespace", () => {
    mockExecFileSync.mockReturnValue("ok\n");
    run("status --short");
    expect(mockExecFileSync).toHaveBeenCalledWith(
      "git",
      ["status", "--short"],
      expect.any(Object)
    );
  });

  it("returns descriptive error on failure with stderr", () => {
    const error = new Error("fail") as any;
    error.stderr = "fatal: not a git repo\n";
    error.stdout = "";
    error.status = 128;
    mockExecFileSync.mockImplementation(() => { throw error; });
    const result = run(["status"]);
    expect(result).toBe("fatal: not a git repo");
  });

  it("returns timeout message when process is killed", () => {
    const error = new Error("killed") as any;
    error.killed = true;
    error.signal = "SIGTERM";
    mockExecFileSync.mockImplementation(() => { throw error; });
    const result = run(["log"], { timeout: 5000 });
    expect(result).toBe("[timed out after 5000ms]");
  });

  it("returns git-not-found message on ENOENT", () => {
    const error = new Error("spawn git ENOENT") as any;
    error.code = "ENOENT";
    mockExecFileSync.mockImplementation(() => { throw error; });
    const result = run(["status"]);
    expect(result).toBe("[git not found]");
  });

  it("returns command-failed with exit code when no stderr/stdout", () => {
    const error = new Error("exit 1") as any;
    error.status = 1;
    error.stdout = "";
    error.stderr = "";
    mockExecFileSync.mockImplementation(() => { throw error; });
    const result = run(["bad-command"]);
    expect(result).toBe("[command failed: git bad-command (exit 1)]");
  });

  it("uses default 10s timeout", () => {
    mockExecFileSync.mockReturnValue("");
    run(["status"]);
    expect(mockExecFileSync).toHaveBeenCalledWith(
      "git",
      ["status"],
      expect.objectContaining({ timeout: 10000 })
    );
  });

  it("respects custom timeout", () => {
    mockExecFileSync.mockReturnValue("");
    run(["log"], { timeout: 30000 });
    expect(mockExecFileSync).toHaveBeenCalledWith(
      "git",
      ["log"],
      expect.objectContaining({ timeout: 30000 })
    );
  });
});

describe("getBranch()", () => {
  it("returns current branch name", () => {
    mockExecFileSync.mockReturnValue("main\n");
    expect(getBranch()).toBe("main");
    expect(mockExecFileSync).toHaveBeenCalledWith(
      "git",
      ["branch", "--show-current"],
      expect.any(Object)
    );
  });
});

describe("getStatus()", () => {
  it("returns short status", () => {
    mockExecFileSync.mockReturnValue(" M src/index.ts\n?? new-file.ts\n");
    expect(getStatus()).toBe("M src/index.ts\n?? new-file.ts");
  });
});

describe("getRecentCommits()", () => {
  it("defaults to 5 commits", () => {
    mockExecFileSync.mockReturnValue("abc123 first\ndef456 second\n");
    getRecentCommits();
    expect(mockExecFileSync).toHaveBeenCalledWith(
      "git",
      ["log", "--oneline", "-5"],
      expect.any(Object)
    );
  });

  it("accepts custom count", () => {
    mockExecFileSync.mockReturnValue("");
    getRecentCommits(10);
    expect(mockExecFileSync).toHaveBeenCalledWith(
      "git",
      ["log", "--oneline", "-10"],
      expect.any(Object)
    );
  });
});

describe("getLastCommit()", () => {
  it("returns last commit oneline", () => {
    mockExecFileSync.mockReturnValue("abc123 fix: stuff\n");
    expect(getLastCommit()).toBe("abc123 fix: stuff");
  });
});

describe("getLastCommitTime()", () => {
  it("returns last commit timestamp", () => {
    mockExecFileSync.mockReturnValue("2026-03-04 21:00:00 -0700\n");
    expect(getLastCommitTime()).toBe("2026-03-04 21:00:00 -0700");
  });
});

describe("getDiffFiles()", () => {
  it("returns diff files for given ref", () => {
    mockExecFileSync.mockReturnValue("src/a.ts\nsrc/b.ts\n");
    expect(getDiffFiles("HEAD~5")).toBe("src/a.ts\nsrc/b.ts");
  });

  it("falls back to HEAD~1 when ref fails", () => {
    mockExecFileSync
      .mockImplementationOnce(() => { throw Object.assign(new Error("fail"), { status: 128, stdout: "", stderr: "" }); })
      .mockReturnValueOnce("src/c.ts\n");
    const result = getDiffFiles("HEAD~10");
    expect(result).toBe("src/c.ts");
  });

  it("returns 'no commits' when both refs fail", () => {
    const err = Object.assign(new Error("fail"), { status: 128, stdout: "", stderr: "" });
    mockExecFileSync.mockImplementation(() => { throw err; });
    expect(getDiffFiles()).toBe("no commits");
  });
});

describe("getStagedFiles()", () => {
  it("returns staged file names", () => {
    mockExecFileSync.mockReturnValue("src/staged.ts\n");
    expect(getStagedFiles()).toBe("src/staged.ts");
  });
});

describe("getDiffStat()", () => {
  it("returns diff stat for given ref", () => {
    mockExecFileSync.mockReturnValue(" 2 files changed, 10 insertions(+)\n");
    expect(getDiffStat("HEAD~3")).toBe("2 files changed, 10 insertions(+)");
  });

  it("falls back to HEAD~3 when ref fails", () => {
    mockExecFileSync
      .mockImplementationOnce(() => { throw Object.assign(new Error("fail"), { status: 128, stdout: "", stderr: "" }); })
      .mockReturnValueOnce(" 1 file changed\n");
    expect(getDiffStat("HEAD~10")).toBe("1 file changed");
  });

  it("returns fallback message when both refs fail", () => {
    const err = Object.assign(new Error("fail"), { status: 128, stdout: "", stderr: "" });
    mockExecFileSync.mockImplementation(() => { throw err; });
    expect(getDiffStat()).toBe("no diff stats available");
  });
});
