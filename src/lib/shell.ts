import { execSync, execFileSync } from "child_process";
import { PROJECT_DIR } from "./files.js";

/**
 * Run an arbitrary shell command (with shell: true).
 * Use this for non-git commands that need pipes, redirects, or shell builtins.
 * Returns stdout on success, descriptive error string on failure.
 */
export function shell(cmd: string, opts: { timeout?: number; cwd?: string } = {}): string {
  try {
    return execSync(cmd, {
      cwd: opts.cwd || PROJECT_DIR,
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
 * Run a non-git executable safely (no shell). Pass command and args separately.
 * Returns stdout on success, descriptive error string on failure.
 */
export function exec(cmd: string, args: string[], opts: { timeout?: number; cwd?: string } = {}): string {
  try {
    return execFileSync(cmd, args, {
      cwd: opts.cwd || PROJECT_DIR,
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
    if (e.code === "ENOENT") return `[${cmd} not found]`;
    return `[command failed: ${cmd} ${args.join(" ")} (exit ${e.status ?? "?"})]`;
  }
}

/**
 * Check if a CLI tool is available on PATH.
 */
export function hasCommand(cmd: string): boolean {
  try {
    execFileSync("which", [cmd], { stdio: ["pipe", "pipe", "pipe"], timeout: 3000 });
    return true;
  } catch {
    return false;
  }
}
