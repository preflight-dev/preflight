import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, rmSync, existsSync } from "fs";
import { join } from "path";

// Set PROJECT_DIR before importing the module
const TEST_DIR = join(process.cwd(), "__test_files_tmp__");
process.env.CLAUDE_PROJECT_DIR = TEST_DIR;

// Dynamic import to pick up env override
const { readIfExists, findWorkspaceDocs, PROJECT_DIR } = await import("../../src/lib/files.js");

describe("PROJECT_DIR", () => {
  it("uses CLAUDE_PROJECT_DIR env var when set", () => {
    expect(PROJECT_DIR).toBe(TEST_DIR);
  });
});

describe("readIfExists", () => {
  beforeEach(() => {
    mkdirSync(TEST_DIR, { recursive: true });
  });

  afterEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it("returns null for non-existent file", () => {
    expect(readIfExists("does-not-exist.txt")).toBeNull();
  });

  it("reads a text file and returns content", () => {
    writeFileSync(join(TEST_DIR, "hello.txt"), "line1\nline2\nline3");
    const result = readIfExists("hello.txt");
    expect(result).toBe("line1\nline2\nline3");
  });

  it("truncates to maxLines", () => {
    const lines = Array.from({ length: 100 }, (_, i) => `line ${i + 1}`);
    writeFileSync(join(TEST_DIR, "long.txt"), lines.join("\n"));
    const result = readIfExists("long.txt", 5);
    expect(result).not.toBeNull();
    expect(result!.split("\n")).toHaveLength(5);
    expect(result).toBe("line 1\nline 2\nline 3\nline 4\nline 5");
  });

  it("returns null for binary files (contains null bytes)", () => {
    const buf = Buffer.from([0x48, 0x65, 0x6c, 0x00, 0x6f]); // "Hel\0o"
    writeFileSync(join(TEST_DIR, "binary.bin"), buf);
    expect(readIfExists("binary.bin")).toBeNull();
  });

  it("reads file in subdirectory", () => {
    mkdirSync(join(TEST_DIR, "sub"), { recursive: true });
    writeFileSync(join(TEST_DIR, "sub", "nested.md"), "# Hello");
    expect(readIfExists("sub/nested.md")).toBe("# Hello");
  });
});

describe("findWorkspaceDocs", () => {
  beforeEach(() => {
    mkdirSync(TEST_DIR, { recursive: true });
  });

  afterEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it("returns empty object when .claude/ does not exist", () => {
    const docs = findWorkspaceDocs();
    expect(docs).toEqual({});
  });

  it("finds markdown files in .claude/", () => {
    const claudeDir = join(TEST_DIR, ".claude");
    mkdirSync(claudeDir, { recursive: true });
    writeFileSync(join(claudeDir, "AGENTS.md"), "# Agents\nSome content");
    writeFileSync(join(claudeDir, "notes.txt"), "not markdown");

    const docs = findWorkspaceDocs();
    expect(Object.keys(docs)).toEqual(["AGENTS.md"]);
    expect(docs["AGENTS.md"].content).toContain("# Agents");
    expect(docs["AGENTS.md"].size).toBeGreaterThan(0);
  });

  it("finds markdown files in nested subdirectories", () => {
    const subDir = join(TEST_DIR, ".claude", "docs");
    mkdirSync(subDir, { recursive: true });
    writeFileSync(join(subDir, "guide.md"), "# Guide");

    const docs = findWorkspaceDocs();
    expect(Object.keys(docs)).toContain("docs/guide.md");
  });

  it("skips node_modules and dotfiles directories", () => {
    const nmDir = join(TEST_DIR, ".claude", "node_modules");
    const dotDir = join(TEST_DIR, ".claude", ".hidden");
    mkdirSync(nmDir, { recursive: true });
    mkdirSync(dotDir, { recursive: true });
    writeFileSync(join(nmDir, "pkg.md"), "# pkg");
    writeFileSync(join(dotDir, "secret.md"), "# secret");

    const docs = findWorkspaceDocs();
    expect(Object.keys(docs)).toHaveLength(0);
  });

  it("skips preflight-state directory", () => {
    const stateDir = join(TEST_DIR, ".claude", "preflight-state");
    mkdirSync(stateDir, { recursive: true });
    writeFileSync(join(stateDir, "log.md"), "# log");

    const docs = findWorkspaceDocs();
    expect(Object.keys(docs)).toHaveLength(0);
  });

  it("returns metadata only when metadataOnly is true", () => {
    const claudeDir = join(TEST_DIR, ".claude");
    mkdirSync(claudeDir, { recursive: true });
    writeFileSync(join(claudeDir, "README.md"), "# Important content here");

    const docs = findWorkspaceDocs({ metadataOnly: true });
    expect(docs["README.md"]).toBeDefined();
    expect(docs["README.md"].content).toBe("");
    expect(docs["README.md"].size).toBeGreaterThan(0);
  });
});
