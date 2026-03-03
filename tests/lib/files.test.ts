import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdirSync, rmSync, writeFileSync } from "fs";
import { join } from "path";

// Must set env BEFORE any import of files.ts
const TEST_DIR = join(__dirname, ".tmp-files-test");

// We need to mock the PROJECT_DIR since it's resolved at import time
vi.stubEnv("CLAUDE_PROJECT_DIR", TEST_DIR);

// Force re-evaluation by resetting module registry
vi.resetModules();

let readIfExists: typeof import("../../src/lib/files.js")["readIfExists"];
let findWorkspaceDocs: typeof import("../../src/lib/files.js")["findWorkspaceDocs"];

beforeEach(async () => {
  rmSync(TEST_DIR, { recursive: true, force: true });
  mkdirSync(TEST_DIR, { recursive: true });
  vi.resetModules();
  vi.stubEnv("CLAUDE_PROJECT_DIR", TEST_DIR);
  const mod = await import("../../src/lib/files.js");
  readIfExists = mod.readIfExists;
  findWorkspaceDocs = mod.findWorkspaceDocs;
});

afterEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
  vi.unstubAllEnvs();
});

describe("readIfExists", () => {
  it("returns null for missing file", () => {
    expect(readIfExists("nope.txt")).toBeNull();
  });

  it("reads a text file", () => {
    writeFileSync(join(TEST_DIR, "hello.txt"), "line1\nline2\nline3");
    const content = readIfExists("hello.txt");
    expect(content).toBe("line1\nline2\nline3");
  });

  it("respects maxLines", () => {
    const lines = Array.from({ length: 100 }, (_, i) => `line ${i}`);
    writeFileSync(join(TEST_DIR, "big.txt"), lines.join("\n"));
    const content = readIfExists("big.txt", 5);
    expect(content!.split("\n")).toHaveLength(5);
  });

  it("returns null for binary files (null bytes)", () => {
    const buf = Buffer.alloc(100);
    buf[50] = 0;
    buf.write("hello", 0);
    writeFileSync(join(TEST_DIR, "binary.bin"), buf);
    expect(readIfExists("binary.bin")).toBeNull();
  });
});

describe("findWorkspaceDocs", () => {
  it("returns empty when .claude dir missing", () => {
    expect(findWorkspaceDocs()).toEqual({});
  });

  it("finds markdown files in .claude/", () => {
    const claudeDir = join(TEST_DIR, ".claude");
    mkdirSync(claudeDir, { recursive: true });
    writeFileSync(join(claudeDir, "notes.md"), "# Notes\nSome content");
    writeFileSync(join(claudeDir, "other.txt"), "not markdown");

    const docs = findWorkspaceDocs();
    expect(Object.keys(docs)).toEqual(["notes.md"]);
    expect(docs["notes.md"].content).toContain("# Notes");
    expect(docs["notes.md"].size).toBeGreaterThan(0);
  });

  it("scans nested directories", () => {
    const subDir = join(TEST_DIR, ".claude", "sub");
    mkdirSync(subDir, { recursive: true });
    writeFileSync(join(subDir, "deep.md"), "# Deep");

    const docs = findWorkspaceDocs();
    expect(docs["sub/deep.md"]).toBeDefined();
  });

  it("supports metadataOnly mode", () => {
    const claudeDir = join(TEST_DIR, ".claude");
    mkdirSync(claudeDir, { recursive: true });
    writeFileSync(join(claudeDir, "doc.md"), "# Content here");

    const docs = findWorkspaceDocs({ metadataOnly: true });
    expect(docs["doc.md"].content).toBe("");
    expect(docs["doc.md"].size).toBeGreaterThan(0);
  });

  it("skips node_modules and hidden dirs", () => {
    const nmDir = join(TEST_DIR, ".claude", "node_modules");
    const hiddenDir = join(TEST_DIR, ".claude", ".hidden");
    mkdirSync(nmDir, { recursive: true });
    mkdirSync(hiddenDir, { recursive: true });
    writeFileSync(join(nmDir, "skip.md"), "skip");
    writeFileSync(join(hiddenDir, "skip.md"), "skip");

    const docs = findWorkspaceDocs();
    expect(Object.keys(docs)).toHaveLength(0);
  });
});
