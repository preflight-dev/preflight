import { describe, it, expect, vi } from "vitest";

// We test the cleanShellArgs logic indirectly through run()
// by mocking execFileSync to capture the args passed to git.

vi.mock("child_process", () => ({
  execFileSync: vi.fn(() => "mocked output"),
  execSync: vi.fn(() => "mocked shell output"),
}));

vi.mock("../../src/lib/files.js", () => ({
  PROJECT_DIR: "/tmp/test-project",
}));

import { run, shell } from "../../src/lib/git.js";
import { execFileSync, execSync } from "child_process";

const mockExecFile = vi.mocked(execFileSync);
const mockExecSync = vi.mocked(execSync);

describe("run()", () => {
  it("accepts array args directly", () => {
    run(["diff", "--stat"]);
    expect(mockExecFile).toHaveBeenCalledWith(
      "git",
      ["diff", "--stat"],
      expect.any(Object)
    );
  });

  it("strips leading 'git' from string commands", () => {
    run("git diff --name-only");
    expect(mockExecFile).toHaveBeenCalledWith(
      "git",
      ["diff", "--name-only"],
      expect.any(Object)
    );
  });

  it("strips 2>/dev/null from string commands", () => {
    run("git status --porcelain 2>/dev/null");
    expect(mockExecFile).toHaveBeenCalledWith(
      "git",
      ["status", "--porcelain"],
      expect.any(Object)
    );
  });

  it("strips 2>&1 from string commands", () => {
    run("git diff --stat 2>&1");
    expect(mockExecFile).toHaveBeenCalledWith(
      "git",
      ["diff", "--stat"],
      expect.any(Object)
    );
  });

  it("stops at || shell operator", () => {
    run("git diff HEAD~5 --name-only || git diff HEAD~3 --name-only");
    expect(mockExecFile).toHaveBeenCalledWith(
      "git",
      ["diff", "HEAD~5", "--name-only"],
      expect.any(Object)
    );
  });

  it("stops at | pipe operator", () => {
    run("git ls-files | head -20");
    expect(mockExecFile).toHaveBeenCalledWith(
      "git",
      ["ls-files"],
      expect.any(Object)
    );
  });

  it("works without git prefix", () => {
    run("diff --stat --no-color");
    expect(mockExecFile).toHaveBeenCalledWith(
      "git",
      ["diff", "--stat", "--no-color"],
      expect.any(Object)
    );
  });
});

describe("shell()", () => {
  it("passes full command string to execSync", () => {
    shell("find tests -name '*.spec.ts' 2>/dev/null | wc -l");
    expect(mockExecSync).toHaveBeenCalledWith(
      "find tests -name '*.spec.ts' 2>/dev/null | wc -l",
      expect.any(Object)
    );
  });
});
