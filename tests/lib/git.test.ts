import { describe, it, expect, vi, beforeEach } from "vitest";
import { execFileSync } from "child_process";

vi.mock("child_process", () => ({
  execFileSync: vi.fn(),
}));

vi.mock("../../src/lib/files.js", () => ({
  PROJECT_DIR: "/fake/project",
}));

const mockedExec = vi.mocked(execFileSync);

// Import after mocks are set up
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

beforeEach(() => {
  vi.clearAllMocks();
});

describe("run()", () => {
  it("accepts an array of args", () => {
    mockedExec.mockReturnValue("ok\n");
    expect(run(["status", "--short"])).toBe("ok");
    expect(mockedExec).toHaveBeenCalledWith(
      "git",
      ["status", "--short"],
      expect.objectContaining({ cwd: "/fake/project" })
    );
  });

  it("splits string args on whitespace", () => {
    mockedExec.mockReturnValue("main\n");
    expect(run("branch --show-current")).toBe("main");
    expect(mockedExec).toHaveBeenCalledWith(
      "git",
      ["branch", "--show-current"],
      expect.anything()
    );
  });

  it("trims output", () => {
    mockedExec.mockReturnValue("  hello world  \n");
    expect(run(["log"])).toBe("hello world");
  });

  it("returns timeout message when process is killed", () => {
    const err: any = new Error("killed");
    err.killed = true;
    mockedExec.mockImplementation(() => { throw err; });
    expect(run(["log"], { timeout: 5000 })).toBe("[timed out after 5000ms]");
  });

  it("returns timeout message on SIGTERM", () => {
    const err: any = new Error("signal");
    err.signal = "SIGTERM";
    mockedExec.mockImplementation(() => { throw err; });
    expect(run(["log"])).toBe("[timed out after 10000ms]");
  });

  it("returns stderr on command failure", () => {
    const err: any = new Error("fail");
    err.stdout = "";
    err.stderr = "fatal: not a git repo\n";
    err.status = 128;
    mockedExec.mockImplementation(() => { throw err; });
    expect(run(["status"])).toBe("fatal: not a git repo");
  });

  it("returns stdout from error if stderr is empty", () => {
    const err: any = new Error("fail");
    err.stdout = "partial output\n";
    err.stderr = "";
    err.status = 1;
    mockedExec.mockImplementation(() => { throw err; });
    expect(run(["diff"])).toBe("partial output");
  });

  it("returns ENOENT message when git is not found", () => {
    const err: any = new Error("not found");
    err.code = "ENOENT";
    err.stdout = "";
    err.stderr = "";
    mockedExec.mockImplementation(() => { throw err; });
    expect(run(["status"])).toBe("[git not found]");
  });

  it("returns generic failure message as fallback", () => {
    const err: any = new Error("unknown");
    err.stdout = "";
    err.stderr = "";
    err.status = 2;
    mockedExec.mockImplementation(() => { throw err; });
    expect(run(["foo", "bar"])).toBe("[command failed: git foo bar (exit 2)]");
  });

  it("handles undefined exit status", () => {
    const err: any = new Error("unknown");
    err.stdout = "";
    err.stderr = "";
    mockedExec.mockImplementation(() => { throw err; });
    expect(run(["x"])).toBe("[command failed: git x (exit ?)]");
  });

  it("uses default 10s timeout", () => {
    mockedExec.mockReturnValue("");
    run(["status"]);
    expect(mockedExec).toHaveBeenCalledWith(
      "git",
      ["status"],
      expect.objectContaining({ timeout: 10000 })
    );
  });

  it("uses custom timeout", () => {
    mockedExec.mockReturnValue("");
    run(["log"], { timeout: 3000 });
    expect(mockedExec).toHaveBeenCalledWith(
      "git",
      ["log"],
      expect.objectContaining({ timeout: 3000 })
    );
  });
});

describe("getBranch()", () => {
  it("returns current branch name", () => {
    mockedExec.mockReturnValue("feature/cool\n");
    expect(getBranch()).toBe("feature/cool");
  });
});

describe("getStatus()", () => {
  it("returns short status", () => {
    mockedExec.mockReturnValue(" M src/index.ts\n?? new.ts\n");
    expect(getStatus()).toBe("M src/index.ts\n?? new.ts");
  });
});

describe("getRecentCommits()", () => {
  it("defaults to 5 commits", () => {
    mockedExec.mockReturnValue("abc123 first\ndef456 second\n");
    getRecentCommits();
    expect(mockedExec).toHaveBeenCalledWith(
      "git",
      ["log", "--oneline", "-5"],
      expect.anything()
    );
  });

  it("accepts custom count", () => {
    mockedExec.mockReturnValue("abc123 first\n");
    getRecentCommits(10);
    expect(mockedExec).toHaveBeenCalledWith(
      "git",
      ["log", "--oneline", "-10"],
      expect.anything()
    );
  });
});

describe("getLastCommit()", () => {
  it("returns single oneline commit", () => {
    mockedExec.mockReturnValue("abc123 fix bug\n");
    expect(getLastCommit()).toBe("abc123 fix bug");
  });
});

describe("getLastCommitTime()", () => {
  it("returns formatted timestamp", () => {
    mockedExec.mockReturnValue("2026-03-10 13:00:00 -0700\n");
    expect(getLastCommitTime()).toBe("2026-03-10 13:00:00 -0700");
  });
});

describe("getDiffFiles()", () => {
  it("returns diff files with default ref", () => {
    mockedExec.mockReturnValue("src/a.ts\nsrc/b.ts\n");
    expect(getDiffFiles()).toBe("src/a.ts\nsrc/b.ts");
    expect(mockedExec).toHaveBeenCalledWith(
      "git",
      ["diff", "--name-only", "HEAD~3"],
      expect.anything()
    );
  });

  it("accepts custom ref", () => {
    mockedExec.mockReturnValue("file.ts\n");
    getDiffFiles("main");
    expect(mockedExec).toHaveBeenCalledWith(
      "git",
      ["diff", "--name-only", "main"],
      expect.anything()
    );
  });

  it("falls back to HEAD~1 on error", () => {
    mockedExec
      .mockReturnValueOnce("[command failed: git diff (exit 1)]" as any)
      .mockReturnValueOnce("fallback.ts\n");
    expect(getDiffFiles()).toBe("fallback.ts");
  });

  it("returns 'no commits' when both attempts fail", () => {
    mockedExec
      .mockReturnValueOnce("[error]" as any)
      .mockReturnValueOnce("[error]" as any);
    expect(getDiffFiles()).toBe("no commits");
  });
});

describe("getStagedFiles()", () => {
  it("returns staged file list", () => {
    mockedExec.mockReturnValue("staged.ts\n");
    expect(getStagedFiles()).toBe("staged.ts");
  });
});

describe("getDiffStat()", () => {
  it("returns diff stat with default ref", () => {
    mockedExec.mockReturnValue(" 2 files changed, 10 insertions(+)\n");
    expect(getDiffStat()).toBe("2 files changed, 10 insertions(+)");
    expect(mockedExec).toHaveBeenCalledWith(
      "git",
      ["diff", "HEAD~5", "--stat"],
      expect.anything()
    );
  });

  it("falls back to HEAD~3 on error", () => {
    mockedExec
      .mockReturnValueOnce("[command failed]" as any)
      .mockReturnValueOnce(" 1 file changed\n");
    expect(getDiffStat()).toBe("1 file changed");
  });

  it("returns fallback message when both fail", () => {
    mockedExec
      .mockReturnValueOnce("[error]" as any)
      .mockReturnValueOnce("[error]" as any);
    expect(getDiffStat()).toBe("no diff stats available");
  });
});
