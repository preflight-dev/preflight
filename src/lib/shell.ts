import { execSync } from "child_process";
import { PROJECT_DIR } from "./files.js";

/**
 * Run an arbitrary shell command in the project directory.
 * Returns stdout on success, empty string on failure.
 * Use this for non-git commands (find, wc, tsc, gh, etc.).
 * For git commands, use `run()` from git.ts instead.
 */
export function shell(cmd: string, opts: { timeout?: number } = {}): string {
  try {
    return execSync(cmd, {
      cwd: PROJECT_DIR,
      encoding: "utf-8",
      timeout: opts.timeout || 15000,
      maxBuffer: 2 * 1024 * 1024,
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
  } catch (e: any) {
    if (e.killed === true || e.signal === "SIGTERM") {
      return `[timed out after ${opts.timeout || 15000}ms]`;
    }
    // Return stdout if available (some commands write to stdout before failing)
    const output = e.stdout?.toString().trim();
    if (output) return output;
    return "";
  }
}
