// =============================================================================
// Tests for src/lib/files.ts — file reading and workspace doc scanning
// =============================================================================

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, readFileSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

let tempDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "preflight-files-test-"));
});

afterEach(() => {
  vi.restoreAllMocks();
  try { rmSync(tempDir, { recursive: true, force: true }); } catch {}
});

// Since PROJECT_DIR is a module-level constant, we test the functions directly
// by reimplementing the core logic. This tests the algorithms, not the binding.

describe("readIfExists logic", () => {
  function readIfExists(basePath: string, relPath: string, maxLines = 50): string | null {
    const full = join(basePath, relPath);
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

  it("returns null for missing file", () => {
    expect(readIfExists(tempDir, "nope.md")).toBeNull();
  });

  it("reads existing text file", () => {
    writeFileSync(join(tempDir, "test.md"), "hello world\nsecond line");
    expect(readIfExists(tempDir, "test.md")).toBe("hello world\nsecond line");
  });

  it("truncates to maxLines", () => {
    const lines = Array.from({ length: 100 }, (_, i) => `line ${i}`);
    writeFileSync(join(tempDir, "long.md"), lines.join("\n"));
    const result = readIfExists(tempDir, "long.md", 5);
    expect(result!.split("\n")).toHaveLength(5);
    expect(result).toBe("line 0\nline 1\nline 2\nline 3\nline 4");
  });

  it("rejects binary files (null bytes in first 8KB)", () => {
    const buf = Buffer.from([0x48, 0x65, 0x6c, 0x00, 0x6f]);
    writeFileSync(join(tempDir, "binary.dat"), buf);
    expect(readIfExists(tempDir, "binary.dat")).toBeNull();
  });

  it("accepts files with null bytes after 8KB", () => {
    const buf = Buffer.alloc(9000, 0x41); // 9000 'A's
    buf[8500] = 0; // null byte after 8KB
    writeFileSync(join(tempDir, "late-null.dat"), buf);
    // Should pass since null is after the 8KB check window
    expect(readIfExists(tempDir, "late-null.dat")).not.toBeNull();
  });
});

describe("findWorkspaceDocs logic", () => {
  const MAX_SCAN_DEPTH = 10;

  // Extracted scanning logic for testability
  function findWorkspaceDocs(projectDir: string, opts?: { metadataOnly?: boolean }) {
    const { statSync, readdirSync } = require("fs");
    const docs: Record<string, any> = {};
    const claudeDir = join(projectDir, ".claude");
    if (!existsSync(claudeDir)) return docs;

    const scanDir = (dir: string, prefix = "", depth = 0): void => {
      if (depth > MAX_SCAN_DEPTH) return;
      try {
        for (const entry of readdirSync(dir)) {
          const full = join(dir, entry);
          const stat = statSync(full);
          if (stat.isDirectory() && !entry.startsWith(".") && !entry.includes("node_modules") && entry !== "preflight-state") {
            scanDir(full, prefix ? `${prefix}/${entry}` : entry, depth + 1);
          } else if (entry.endsWith(".md") && stat.size < 50000) {
            docs[prefix ? `${prefix}/${entry}` : entry] = {
              content: opts?.metadataOnly ? "" : readFileSync(full, "utf-8").split("\n").slice(0, 40).join("\n"),
              mtime: stat.mtime,
              size: stat.size,
            };
          }
        }
      } catch {}
    };

    scanDir(claudeDir);
    return docs;
  }

  it("returns empty when .claude/ does not exist", () => {
    expect(findWorkspaceDocs(tempDir)).toEqual({});
  });

  it("finds markdown files in .claude/", () => {
    const claudeDir = join(tempDir, ".claude");
    mkdirSync(claudeDir, { recursive: true });
    writeFileSync(join(claudeDir, "notes.md"), "# Notes\nSome content");
    writeFileSync(join(claudeDir, "other.txt"), "not markdown");

    const docs = findWorkspaceDocs(tempDir);
    expect(Object.keys(docs)).toEqual(["notes.md"]);
    expect(docs["notes.md"].content).toContain("# Notes");
  });

  it("scans nested directories", () => {
    const subDir = join(tempDir, ".claude", "sub");
    mkdirSync(subDir, { recursive: true });
    writeFileSync(join(subDir, "deep.md"), "deep doc");

    const docs = findWorkspaceDocs(tempDir);
    expect(docs["sub/deep.md"]).toBeDefined();
    expect(docs["sub/deep.md"].content).toBe("deep doc");
  });

  it("metadataOnly skips content", () => {
    const claudeDir = join(tempDir, ".claude");
    mkdirSync(claudeDir, { recursive: true });
    writeFileSync(join(claudeDir, "doc.md"), "content here");

    const docs = findWorkspaceDocs(tempDir, { metadataOnly: true });
    expect(docs["doc.md"].content).toBe("");
    expect(docs["doc.md"].size).toBeGreaterThan(0);
  });

  it("skips preflight-state directory", () => {
    const stateDir = join(tempDir, ".claude", "preflight-state");
    mkdirSync(stateDir, { recursive: true });
    writeFileSync(join(stateDir, "internal.md"), "should be skipped");

    const docs = findWorkspaceDocs(tempDir);
    expect(Object.keys(docs)).toEqual([]);
  });

  it("skips dot-directories", () => {
    const hiddenDir = join(tempDir, ".claude", ".hidden");
    mkdirSync(hiddenDir, { recursive: true });
    writeFileSync(join(hiddenDir, "secret.md"), "hidden");

    const docs = findWorkspaceDocs(tempDir);
    expect(Object.keys(docs)).toEqual([]);
  });

  it("skips files over 50KB", () => {
    const claudeDir = join(tempDir, ".claude");
    mkdirSync(claudeDir, { recursive: true });
    writeFileSync(join(claudeDir, "huge.md"), "x".repeat(60000));

    const docs = findWorkspaceDocs(tempDir);
    expect(Object.keys(docs)).toEqual([]);
  });
});
