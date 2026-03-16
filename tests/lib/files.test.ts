import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

let readIfExists: typeof import("../../src/lib/files.js").readIfExists;
let findWorkspaceDocs: typeof import("../../src/lib/files.js").findWorkspaceDocs;

let tempDir: string;

beforeEach(async () => {
  tempDir = mkdtempSync(join(tmpdir(), "preflight-files-test-"));
  process.env.CLAUDE_PROJECT_DIR = tempDir;
  // Clear module cache so PROJECT_DIR re-evaluates
  vi.resetModules();
  const mod = await import("../../src/lib/files.js");
  readIfExists = mod.readIfExists;
  findWorkspaceDocs = mod.findWorkspaceDocs;
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
  delete process.env.CLAUDE_PROJECT_DIR;
});

describe("readIfExists", () => {
  it("returns null for missing files", () => {
    expect(readIfExists("nonexistent.md")).toBeNull();
  });

  it("reads existing text file", () => {
    writeFileSync(join(tempDir, "hello.txt"), "line1\nline2\nline3");
    const result = readIfExists("hello.txt");
    expect(result).toBe("line1\nline2\nline3");
  });

  it("truncates to maxLines", () => {
    const lines = Array.from({ length: 100 }, (_, i) => `line ${i}`);
    writeFileSync(join(tempDir, "long.txt"), lines.join("\n"));
    const result = readIfExists("long.txt", 5);
    expect(result!.split("\n")).toHaveLength(5);
    expect(result).toBe("line 0\nline 1\nline 2\nline 3\nline 4");
  });

  it("returns null for binary files", () => {
    const buf = Buffer.alloc(100);
    buf[10] = 0; // null byte
    writeFileSync(join(tempDir, "binary.dat"), buf);
    expect(readIfExists("binary.dat")).toBeNull();
  });
});

describe("findWorkspaceDocs", () => {
  it("returns empty when .claude dir missing", () => {
    expect(findWorkspaceDocs()).toEqual({});
  });

  it("finds markdown files in .claude/", () => {
    const claudeDir = join(tempDir, ".claude");
    mkdirSync(claudeDir, { recursive: true });
    writeFileSync(join(claudeDir, "rules.md"), "# Rules\nBe good");
    writeFileSync(join(claudeDir, "notes.md"), "# Notes\nStuff");
    writeFileSync(join(claudeDir, "ignore.txt"), "not markdown");

    const docs = findWorkspaceDocs();
    expect(Object.keys(docs)).toEqual(["notes.md", "rules.md"]);
    expect(docs["rules.md"].content).toContain("# Rules");
  });

  it("scans nested directories", () => {
    const subDir = join(tempDir, ".claude", "sub");
    mkdirSync(subDir, { recursive: true });
    writeFileSync(join(subDir, "deep.md"), "# Deep");

    const docs = findWorkspaceDocs();
    expect(docs["sub/deep.md"]).toBeDefined();
    expect(docs["sub/deep.md"].content).toContain("# Deep");
  });

  it("skips node_modules and preflight-state", () => {
    const nmDir = join(tempDir, ".claude", "node_modules");
    const psDir = join(tempDir, ".claude", "preflight-state");
    mkdirSync(nmDir, { recursive: true });
    mkdirSync(psDir, { recursive: true });
    writeFileSync(join(nmDir, "pkg.md"), "skip");
    writeFileSync(join(psDir, "state.md"), "skip");

    expect(findWorkspaceDocs()).toEqual({});
  });

  it("metadataOnly skips content", () => {
    const claudeDir = join(tempDir, ".claude");
    mkdirSync(claudeDir, { recursive: true });
    writeFileSync(join(claudeDir, "doc.md"), "# Content here");

    const docs = findWorkspaceDocs({ metadataOnly: true });
    expect(docs["doc.md"].content).toBe("");
    expect(docs["doc.md"].size).toBeGreaterThan(0);
  });
});
