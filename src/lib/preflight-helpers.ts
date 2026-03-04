/**
 * Pure helper functions for the preflight_check unified entry point.
 * Extracted for testability — no side effects, no external dependencies
 * (except file system checks which are isolated).
 */

import { existsSync, statSync } from "fs";
import { resolve } from "path";

/** Extract file paths from prompt text */
export function extractFilePaths(prompt: string): string[] {
  const matches = prompt.match(/[\w\-./\\]+\.\w{1,6}/g) || [];
  return [...new Set(matches)];
}

/** Verify files exist and return status lines. projectDir scopes the check. */
export function verifyFiles(paths: string[], projectDir: string): string[] {
  const lines: string[] = [];
  for (const p of paths) {
    const abs = resolve(projectDir, p);
    if (!abs.startsWith(resolve(projectDir))) continue; // path traversal guard
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
  const filePaths = extractFilePaths(prompt);
  if (/\b(it|them|the thing|that|those|this|these)\b/i.test(prompt)) {
    issues.push("Contains vague pronouns — clarify what 'it'/'them' refers to");
  }
  if (/\b(fix|update|change|refactor|improve)\b/i.test(prompt) && !filePaths.length) {
    issues.push("Vague verb without specific file targets");
  }
  if (prompt.trim().length < 40) {
    issues.push("Very short prompt — likely missing context");
  }
  return issues;
}

/** Estimate scope complexity from file paths */
export function estimateComplexity(filePaths: string[]): "SMALL" | "MEDIUM" | "LARGE" {
  const hasMultipleFiles = filePaths.length > 3;
  const hasMultipleDirs = new Set(filePaths.map(f => f.split("/")[0])).size > 2;
  return hasMultipleFiles && hasMultipleDirs ? "LARGE" : filePaths.length > 1 ? "MEDIUM" : "SMALL";
}

/** Split prompt into sub-tasks for sequencing */
export function splitSubtasks(prompt: string): { step: string; risk: string }[] {
  const parts = prompt
    .split(/\b(?:then|after that|next|finally)\b|(?:,\s*and\s+)|(?:\band\b(?=\s+(?:update|add|remove|create|fix|change|refactor|implement|deploy)))/i)
    .map(s => s.trim())
    .filter(s => s.length > 5);

  if (parts.length <= 1) {
    return [{ step: prompt.slice(0, 100), risk: "🟡 MEDIUM" }];
  }

  return parts.map(part => {
    const risk = /schema|migrat|database|config|env|deploy/i.test(part) ? "🔴 HIGH" :
                 /api|route|endpoint/i.test(part) ? "🟡 MEDIUM" : "🟢 LOW";
    return { step: part.charAt(0).toUpperCase() + part.slice(1), risk };
  });
}
