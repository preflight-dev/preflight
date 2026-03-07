import { writeFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";
import { run, getBranch, getStatus, getLastCommit, getStagedFiles } from "./git.js";
import { PROJECT_DIR } from "./files.js";
import { appendLog, now } from "./state.js";

export interface CheckpointInput {
  summary: string;
  next_steps: string;
  current_blockers?: string;
  commit_mode?: "staged" | "tracked" | "all";
}

export interface CheckpointResult {
  checkpointFile: string;
  branch: string;
  commitMode: string;
  commitResult: string;
  timestamp: string;
}

/**
 * Write a checkpoint file and optionally commit. Returns structured result.
 * Shared between the checkpoint tool and auto-checkpoint in session-health.
 */
export function writeCheckpoint(input: CheckpointInput): CheckpointResult {
  const { summary, next_steps, current_blockers } = input;
  const mode = input.commit_mode || "tracked";
  const branch = getBranch();
  const dirty = getStatus();
  const lastCommit = getLastCommit();
  const timestamp = now();

  // Ensure checkpoint directory
  const checkpointDir = join(PROJECT_DIR, ".claude");
  if (!existsSync(checkpointDir)) mkdirSync(checkpointDir, { recursive: true });

  const checkpointFile = join(checkpointDir, "last-checkpoint.md");
  const checkpointContent = `# Session Checkpoint
**Time**: ${timestamp}
**Branch**: ${branch}
**Last Commit**: ${lastCommit}

## Accomplished
${summary}

## Next Steps
${next_steps}

${current_blockers ? `## Blockers\n${current_blockers}\n` : ""}
## Uncommitted Work (at checkpoint time)
\`\`\`
${dirty || "clean"}
\`\`\`
`;
  writeFileSync(checkpointFile, checkpointContent);

  appendLog("checkpoint-log.jsonl", {
    timestamp,
    branch,
    summary,
    next_steps,
    blockers: current_blockers || null,
    dirty_files: dirty ? dirty.split("\n").filter(Boolean).length : 0,
    commit_mode: mode,
  });

  // Commit based on mode
  let commitResult = "no uncommitted changes";
  if (dirty) {
    const shortSummary = summary.split("\n")[0].slice(0, 72);
    const commitMsg = `checkpoint: ${shortSummary}`;

    let addCmd: string;
    switch (mode) {
      case "staged": {
        const staged = getStagedFiles();
        if (!staged) {
          commitResult = "nothing staged — skipped commit (use 'tracked' or 'all' mode, or stage files first)";
        }
        addCmd = "true"; // noop, already staged
        break;
      }
      case "all":
        addCmd = "git add -A";
        break;
      case "tracked":
      default:
        addCmd = "git add -u";
        break;
    }

    if (commitResult === "no uncommitted changes") {
      run(`git add "${checkpointFile}"`);
      const result = run(`${addCmd} && git commit -m "${commitMsg.replace(/"/g, '\\"')}" 2>&1`);
      if (result.includes("commit failed") || result.includes("nothing to commit")) {
        run("git reset HEAD 2>/dev/null");
        commitResult = `commit failed: ${result}`;
      } else {
        commitResult = result;
      }
    }
  }

  return { checkpointFile: ".claude/last-checkpoint.md", branch, commitMode: mode, commitResult, timestamp };
}
