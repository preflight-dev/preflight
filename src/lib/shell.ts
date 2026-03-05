import { execSync } from "child_process";
import { PROJECT_DIR } from "./files.js";

/**
 * Run an arbitrary shell command (with pipes, redirects, etc.).
 * Use this instead of `run()` when you need shell features.
 * `run()` is for git-only commands via execFileSync (no shell).
 *
 * Returns stdout trimmed. On failure returns a bracketed error string.
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
    return `[shell failed: ${cmd} (exit ${e.status ?? "?"})]`;
  }
}

/**
 * Escape a string for safe interpolation into a shell command.
 * Wraps in single quotes and escapes embedded single quotes.
 */
export function shellEscape(s: string): string {
  return "'" + s.replace(/'/g, "'\\''") + "'";
}
