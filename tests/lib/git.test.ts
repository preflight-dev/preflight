import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock child_process before importing the module
vi.mock("child_process", () => ({
  execFileSync: vi.fn().mockReturnValue("mock output"),
  execSync: vi.fn().mockReturnValue("shell output"),
}));

vi.mock("../../src/lib/files.js", () => ({
  PROJECT_DIR: "/mock/project",
}));

import { run, shell } from "../../src/lib/git.js";
import { execFileSync, execSync } from "child_process";

describe("run()", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (execFileSync as any).mockReturnValue("mock output");
  });

  it("accepts an array of args", () => {
    run(["status", "--short"]);
    expect(execFileSync).toHaveBeenCalledWith(
      "git",
      ["status", "--short"],
      expect.any(Object)
    );
  });

  it("splits string args on whitespace", () => {
    run("status --short");
    expect(execFileSync).toHaveBeenCalledWith(
      "git",
      ["status", "--short"],
      expect.any(Object)
    );
  });

  it("strips leading 'git' from string to avoid duplication", () => {
    run("git status --short");
    expect(execFileSync).toHaveBeenCalledWith(
      "git",
      ["status", "--short"],
      expect.any(Object)
    );
  });

  it("strips 2>/dev/null from string args", () => {
    run("diff --name-only HEAD~1 2>/dev/null");
    expect(execFileSync).toHaveBeenCalledWith(
      "git",
      ["diff", "--name-only", "HEAD~1"],
      expect.any(Object)
    );
  });

  it("strips || fallback clauses from string args", () => {
    run("diff --name-only HEAD~10 2>/dev/null || echo ''");
    expect(execFileSync).toHaveBeenCalledWith(
      "git",
      ["diff", "--name-only", "HEAD~10"],
      expect.any(Object)
    );
  });

  it("strips pipe chains from string args", () => {
    run("diff --stat | tail -1");
    expect(execFileSync).toHaveBeenCalledWith(
      "git",
      ["diff", "--stat"],
      expect.any(Object)
    );
  });

  it("returns trimmed output on success", () => {
    (execFileSync as any).mockReturnValue("  result\n");
    expect(run(["log"])).toBe("result");
  });

  it("returns error message on timeout", () => {
    const err = new Error("killed") as any;
    err.killed = true;
    (execFileSync as any).mockImplementation(() => { throw err; });
    expect(run(["log"])).toContain("timed out");
  });

  it("returns stderr on command failure", () => {
    const err = new Error("fail") as any;
    err.stderr = "fatal: not a git repo";
    err.stdout = "";
    (execFileSync as any).mockImplementation(() => { throw err; });
    expect(run(["status"])).toBe("fatal: not a git repo");
  });

  it("returns ENOENT message when git not found", () => {
    const err = new Error("fail") as any;
    err.code = "ENOENT";
    (execFileSync as any).mockImplementation(() => { throw err; });
    expect(run(["status"])).toBe("[git not found]");
  });
});

describe("shell()", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (execSync as any).mockReturnValue("shell output");
  });

  it("passes command string directly to execSync", () => {
    shell("git ls-files | grep test | head -5");
    expect(execSync).toHaveBeenCalledWith(
      "git ls-files | grep test | head -5",
      expect.any(Object)
    );
  });

  it("returns trimmed output", () => {
    (execSync as any).mockReturnValue("  result\n");
    expect(shell("echo hi")).toBe("result");
  });

  it("returns error message on timeout", () => {
    const err = new Error("killed") as any;
    err.killed = true;
    (execSync as any).mockImplementation(() => { throw err; });
    expect(shell("sleep 100")).toContain("timed out");
  });
});
