/**
 * Extracted helpers from preflight-check tool for testability.
 */
import { existsSync, statSync } from "fs";
import { resolve } from "path";
import { PROJECT_DIR } from "./files.js";

// Common false positives that look like file paths but aren't
const FALSE_POSITIVE_PATHS = new Set([
  "e.g.", "i.e.", "etc.", "vs.", "v1", "v2", "v3", "v4", "v5",
  "node.js", "next.js", "vue.js", "react.js", "express.js", "bun.js",
]);

// Version-like patterns: v1.2.3, 3.2.0, etc.
const VERSION_PATTERN = /^v?\d+\.\d+(\.\d+)?$/;

// Must contain a slash OR end with a real file extension
const REAL_FILE_EXTENSIONS = new Set([
  "ts", "tsx", "js", "jsx", "mjs", "cjs",
  "json", "yaml", "yml", "toml", "md", "mdx",
  "css", "scss", "less", "html", "vue", "svelte",
  "py", "rb", "rs", "go", "java", "c", "cpp", "h",
  "sh", "bash", "zsh", "fish",
  "sql", "graphql", "gql", "prisma",
  "env", "lock", "log", "txt", "csv",
  "png", "jpg", "jpeg", "gif", "svg", "ico", "webp",
  "wasm", "map", "d",
]);

/** Extract file paths from prompt text, filtering out false positives */
export function extractFilePaths(prompt: string): string[] {
  const matches = prompt.match(/[\w\-./\\]+\.\w{1,6}/g) || [];
  return [...new Set(matches)].filter((m) => {
    // Remove trailing punctuation that got captured
    const clean = m.replace(/[.,;:!?)]+$/, "");
    if (!clean.includes(".")) return false;

    // Filter known false positives
    const lower = clean.toLowerCase();
    if (FALSE_POSITIVE_PATHS.has(lower)) return false;

    // Filter version strings
    if (VERSION_PATTERN.test(clean)) return false;

    // Must have a slash (path separator) or a recognized extension
    if (clean.includes("/") || clean.includes("\\")) return true;
    const ext = clean.split(".").pop()?.toLowerCase() ?? "";
    return REAL_FILE_EXTENSIONS.has(ext);
  });
}

/** Verify files exist relative to PROJECT_DIR and return status lines */
export function verifyFiles(paths: string[]): string[] {
  const lines: string[] = [];
  for (const p of paths) {
    const abs = resolve(PROJECT_DIR, p);
    if (!abs.startsWith(resolve(PROJECT_DIR))) continue; // path traversal guard
    if (existsSync(abs)) {
      const s = statSync(abs);
      lines.push(`✅ \`${p}\` — ${s.size} bytes, modified ${s.mtime.toISOString().slice(0, 16)}`);
    } else {
      lines.push(`❌ \`${p}\` — not found`);
    }
  }
  return lines;
}

/** Detect ambiguity signals in a prompt */
export function detectAmbiguity(prompt: string): string[] {
  const issues: string[] = [];
  if (/\b(it|them|the thing|that|those|this|these)\b/i.test(prompt))
    issues.push("Contains vague pronouns — clarify what 'it'/'them' refers to");
  if (/\b(fix|update|change|refactor|improve)\b/i.test(prompt) && !extractFilePaths(prompt).length)
    issues.push("Vague verb without specific file targets");
  if (prompt.trim().length < 40)
    issues.push("Very short prompt — likely missing context");
  return issues;
}

/** Estimate scope complexity from file references */
export function estimateComplexity(filePaths: string[]): "SMALL" | "MEDIUM" | "LARGE" {
  const hasMultipleFiles = filePaths.length > 3;
  const hasMultipleDirs = new Set(filePaths.map((f) => f.split("/")[0])).size > 2;
  return hasMultipleFiles && hasMultipleDirs ? "LARGE" : filePaths.length > 1 ? "MEDIUM" : "SMALL";
}

/** Split prompt into sub-tasks for sequencing */
export function splitSubtasks(prompt: string): { task: string; risk: string }[] {
  const parts = prompt
    .split(/\b(?:then|after that|next|finally)\b|(?:,\s*and\s+)|(?:\band\b(?=\s+(?:update|add|remove|create|fix|change|refactor|implement|deploy)))/i)
    .map((s) => s.trim())
    .filter((s) => s.length > 5);

  return (parts.length > 1 ? parts : [prompt.slice(0, 100)]).map((part) => {
    const risk = /schema|migrat|database|config|env|deploy/i.test(part)
      ? "🔴 HIGH"
      : /api|route|endpoint/i.test(part)
        ? "🟡 MEDIUM"
        : "🟢 LOW";
    return { task: part.charAt(0).toUpperCase() + part.slice(1), risk };
  });
}
