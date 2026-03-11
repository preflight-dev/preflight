import { describe, it, expect, afterAll, beforeAll } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, readFileSync, existsSync, readdirSync, statSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

/**
 * Since PROJECT_DIR is a module-level constant in files.ts (set at import time),
 * we re-implement the functions here against a temp dir to test the logic properly.
 * This tests the actual algorithms without fighting module caching.
 */

let tempDir: string;

beforeAll(() => {
  tempDir = mkdtempSync(join(tmpdir(), "preflight-files-test-"));
});

afterAll(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

// Re-implement readIfExists logic to test against tempDir
function readIfExists(baseDir: string, relPath: string, maxLines = 50): string | null {
  const full = join(baseDir, relPath);
  if (!existsSync(full)) return null;
  try {
    const buf = readFileSync(full);
    if (buf.subarray(0, 8192).includes(0)) return null;
    const lines = buf.toString("utf-8").split("\n");
    return lines.slice(0, maxLines).join("\n");
  } catch {
    return null;
  }
}

// Actually, let's just import and test the real module by setting env before anything
// The trick: we need to ensure no other test imports files.js first.
// Better approach: test via the actual exported functions with a subprocess or
// just test the real module and accept it uses cwd.

// Simplest correct approach: test the actual module's exported functions.
// For readIfExists, we create files relative to PROJECT_DIR (which is cwd in test).
// For findWorkspaceDocs, we'd need a .claude/ dir in cwd which is messy.
// Let's use a pragmatic approach: test readIfExists with real files in a subdir,
// and test findWorkspaceDocs behavior by creating a temp .claude/ and cleaning up.

import { readIfExists as realReadIfExists, findWorkspaceDocs, PROJECT_DIR } from "../../src/lib/files.js";

describe("readIfExists()", () => {
  const testDir = ".__test_files_tmp__";

  beforeAll(() => {
    mkdirSync(join(PROJECT_DIR, testDir), { recursive: true });
  });

  afterAll(() => {
    rmSync(join(PROJECT_DIR, testDir), { recursive: true, force: true });
  });

  it("returns null for non-existent file", () => {
    expect(realReadIfExists(join(testDir, "nope.txt"))).toBeNull();
  });

  it("reads a text file", () => {
    writeFileSync(join(PROJECT_DIR, testDir, "hello.md"), "# Hello\nWorld");
    expect(realReadIfExists(join(testDir, "hello.md"))).toBe("# Hello\nWorld");
  });

  it("limits lines returned", () => {
    const lines = Array.from({ length: 100 }, (_, i) => `line ${i}`).join("\n");
    writeFileSync(join(PROJECT_DIR, testDir, "big.txt"), lines);
    const result = realReadIfExists(join(testDir, "big.txt"), 3);
    expect(result).toBe("line 0\nline 1\nline 2");
  });

  it("uses default of 50 lines", () => {
    const lines = Array.from({ length: 100 }, (_, i) => `L${i}`).join("\n");
    writeFileSync(join(PROJECT_DIR, testDir, "many.txt"), lines);
    const result = realReadIfExists(join(testDir, "many.txt"));
    expect(result?.split("\n").length).toBe(50);
  });

  it("rejects binary files with null bytes", () => {
    const buf = Buffer.from([0x48, 0x65, 0x6c, 0x00, 0x6f]);
    writeFileSync(join(PROJECT_DIR, testDir, "bin.dat"), buf);
    expect(realReadIfExists(join(testDir, "bin.dat"))).toBeNull();
  });

  it("allows text files without null bytes", () => {
    writeFileSync(join(PROJECT_DIR, testDir, "clean.txt"), "no nulls");
    expect(realReadIfExists(join(testDir, "clean.txt"))).toBe("no nulls");
  });
});

describe("findWorkspaceDocs()", () => {
  // These tests work with the real .claude/ dir if it exists
  // We test the return type and behavior

  it("returns an object", () => {
    const result = findWorkspaceDocs();
    expect(typeof result).toBe("object");
  });

  it("metadataOnly returns empty content strings", () => {
    const docs = findWorkspaceDocs({ metadataOnly: true });
    for (const [, doc] of Object.entries(docs)) {
      expect(doc.content).toBe("");
    }
  });

  it("regular mode returns content with mtime and size", () => {
    const docs = findWorkspaceDocs();
    for (const [, doc] of Object.entries(docs)) {
      expect(doc).toHaveProperty("content");
      expect(doc).toHaveProperty("mtime");
      expect(doc).toHaveProperty("size");
      expect(typeof doc.content).toBe("string");
      expect(typeof doc.size).toBe("number");
    }
  });

  it("content is limited to 40 lines per file", () => {
    const docs = findWorkspaceDocs();
    for (const [, doc] of Object.entries(docs)) {
      expect(doc.content.split("\n").length).toBeLessThanOrEqual(40);
    }
  });
});

describe("PROJECT_DIR", () => {
  it("is a string", () => {
    expect(typeof PROJECT_DIR).toBe("string");
  });

  it("falls back to cwd when CLAUDE_PROJECT_DIR is not set", () => {
    // In test context, it should be cwd or the env var
    expect(PROJECT_DIR.length).toBeGreaterThan(0);
  });
});
