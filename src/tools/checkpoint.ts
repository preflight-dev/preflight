import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { writeCheckpoint } from "../lib/checkpoint-writer.js";

export function registerCheckpoint(server: McpServer): void {
  server.tool(
    "checkpoint",
    `Save a session checkpoint before context compaction hits. Commits current work, writes session state to workspace docs, and creates a resumption note. Call this proactively when session is getting long, or when the session-health hook warns about turn count. This is your "save game" before compaction wipes context.`,
    {
      summary: z.string().describe("What was accomplished so far in this session"),
      next_steps: z.string().describe("What still needs to be done"),
      current_blockers: z.string().optional().describe("Any issues or blockers encountered"),
      commit_mode: z.enum(["staged", "tracked", "all"]).optional().describe("What to commit: 'staged' (only staged files), 'tracked' (modified tracked files), 'all' (git add -A). Default: 'tracked'"),
    },
    async ({ summary, next_steps, current_blockers, commit_mode }) => {
      const result = writeCheckpoint({ summary, next_steps, current_blockers, commit_mode });

      return {
        content: [{
          type: "text" as const,
          text: `## Checkpoint Saved ✅
**File**: ${result.checkpointFile}
**Branch**: ${result.branch}
**Commit mode**: ${result.commitMode}
**Commit**: ${result.commitResult}

### What's saved:
- Summary of work done
- Next steps for continuation
${current_blockers ? "- Current blockers\n" : ""}- Working tree state at checkpoint time

### To resume after compaction:
Tell the next session/continuation: "Read .claude/last-checkpoint.md for where I left off"`,
        }],
      };
    }
  );
}
