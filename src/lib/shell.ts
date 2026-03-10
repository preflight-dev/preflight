import { execSync } from "child_process";
import { PROJECT_DIR } from "./files.js";

/**
 * Run a shell command string (with pipes, redirects, etc.).
 * Use this for non-git commands or commands that need shell interpretation.
 * Returns stdout+stderr on success, or a descriptive error string on failure.
 */
export function shell(cmd: string, opts: { timeout?: number } = {}): string {
  try {
    return execSync(cmd, {
      cwd: PROJECT_DIR,
      encoding: "utf-8",
      timeout: opts.timeout || 30000,
      maxBuffer: 2 * 1024 * 1024,
      stdio: ["pipe", "pipe", "pipe"],
      shell: "/bin/sh",
    }).trim();
  } catch (e: any) {
    if (e.killed === true || e.signal === "SIGTERM") {
      return `[timed out after ${opts.timeout || 30000}ms]`;
    }
    // For commands like tsc that exit non-zero but produce useful output
    const output = (e.stdout || "") + (e.stderr || "");
    if (output.trim()) return output.trim();
    return `[command failed: ${cmd} (exit ${e.status ?? "?"})]`;
  }
}
