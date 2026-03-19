import { execFileSync, execSync } from "child_process";
import { PROJECT_DIR } from "./files.js";
import type { RunError } from "../types.js";

/**
 * Run a shell command string (supports pipes, redirects, etc.).
 * Returns stdout on success, descriptive error string on failure.
 */
export function shell(cmd: string, opts: { timeout?: number } = {}): string {
  try {
    return execSync(cmd, {
      cwd: PROJECT_DIR,
      encoding: "utf-8",
      timeout: opts.timeout || 10000,
      maxBuffer: 1024 * 1024,
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
  } catch (e: any) {
    if (e.killed === true || e.signal === "SIGTERM") {
      return `[timed out after ${opts.timeout || 10000}ms]`;
    }
    const output = e.stdout?.trim() || e.stderr?.trim();
    if (output) return output;
    return `[command failed: ${cmd} (exit ${e.status ?? "?"})]`;
  }
}

/**
 * Run a git command safely using execFileSync (no shell injection).
 * Accepts an array of args (preferred) or a string (split on whitespace for backward compat).
 * When passed a string, strips a leading "git" if present and removes shell syntax
 * (redirections like 2>/dev/null, || clauses) that don't work with execFileSync.
 * Returns stdout on success. On failure, returns a descriptive error string.
 */
export function run(argsOrCmd: string | string[], opts: { timeout?: number } = {}): string {
  let args: string[];
  if (typeof argsOrCmd === "string") {
    // Strip shell syntax that doesn't work with execFileSync
    let cleaned = argsOrCmd
      .replace(/\s*2>&?\d*\s*>?\s*\/dev\/null/g, "")  // 2>/dev/null, 2>&1
      .replace(/\s*\|.*$/g, "")                          // pipe chains
      .replace(/\s*\|\|.*$/g, "")                        // || fallbacks
      .trim();
    args = cleaned.split(/\s+/).filter(Boolean);
    // Strip leading "git" if caller passed it (run already prepends git)
    if (args[0] === "git") args = args.slice(1);
  } else {
    args = argsOrCmd;
  }
  try {
    return execFileSync("git", args, {
      cwd: PROJECT_DIR,
      encoding: "utf-8",
      timeout: opts.timeout || 10000,
      maxBuffer: 1024 * 1024,
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
  } catch (e: any) {
    const timedOut = e.killed === true || e.signal === "SIGTERM";
    if (timedOut) {
      return `[timed out after ${opts.timeout || 10000}ms]`;
    }
    // Return stderr/stdout if available, otherwise the error message
    const output = e.stdout?.trim() || e.stderr?.trim();
    if (output) return output;
    if (e.code === "ENOENT") return "[git not found]";
    return `[command failed: git ${args.join(" ")} (exit ${e.status ?? "?"})]`;
  }
}

/** Convenience: run a raw command string (split on spaces). Only for simple, known-safe commands. */
function gitCmd(cmdStr: string, opts?: { timeout?: number }): string {
  return run(cmdStr.split(/\s+/), opts);
}

/** Get the current branch name. */
export function getBranch(): string {
  return run(["branch", "--show-current"]);
}

/** Get short git status. */
export function getStatus(): string {
  return run(["status", "--short"]);
}

/** Get recent commits as oneline. */
export function getRecentCommits(count = 5): string {
  return run(["log", "--oneline", `-${count}`]);
}

/** Get the last commit as oneline. */
export function getLastCommit(): string {
  return run(["log", "--oneline", "-1"]);
}

/** Get the last commit timestamp. */
export function getLastCommitTime(): string {
  return run(["log", "-1", "--format=%ci"]);
}

/**
 * Get files changed since `ref`. Falls back to HEAD~1, then "no commits".
 * Uses explicit fallback steps instead of shell chaining.
 */
export function getDiffFiles(ref = "HEAD~3"): string {
  const result = run(["diff", "--name-only", ref]);
  if (!result.startsWith("[")) return result;
  const fallback = run(["diff", "--name-only", "HEAD~1"]);
  if (!fallback.startsWith("[")) return fallback;
  return "no commits";
}

/** Get staged files. */
export function getStagedFiles(): string {
  return run(["diff", "--staged", "--name-only"]);
}

/**
 * Get diff stat since `ref`. Falls back to HEAD~3.
 */
export function getDiffStat(ref = "HEAD~5"): string {
  const result = run(["diff", ref, "--stat"]);
  if (!result.startsWith("[")) return result;
  const fallback = run(["diff", "HEAD~3", "--stat"]);
  if (!fallback.startsWith("[")) return fallback;
  return "no diff stats available";
}
