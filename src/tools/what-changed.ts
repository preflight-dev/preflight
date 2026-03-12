import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { run, getBranch, getDiffFiles, getDiffStat } from "../lib/git.js";

export function registerWhatChanged(server: McpServer): void {
  server.tool(
    "what_changed",
    `Summarize what changed recently. Useful after sub-agents finish, after a break, when context was compacted, or at the start of a new session. Returns diff summary with commit messages.`,
    {
      since: z.string().optional().describe("Git ref: 'HEAD~5', 'HEAD~3', etc. Default: HEAD~5"),
    },
    async ({ since }) => {
      const ref = since || "HEAD~5";
      const diffStat = getDiffStat(ref);
      const diffFiles = getDiffFiles(ref);
      const log = run(["log", `${ref}..HEAD`, "--oneline"]);
      const commitLog = log.startsWith("[") ? run(["log", "-5", "--oneline"]) : log;
      const branch = getBranch();

      const fileList = diffFiles.split("\n").filter(Boolean);
      const fileCount = fileList.length;
      const commitCount = commitLog.split("\n").filter(Boolean).length;

      return {
        content: [{
          type: "text" as const,
          text: `## What Changed (since ${ref})
Branch: ${branch}
**${commitCount} commits**, **${fileCount} files** changed

### Commits
\`\`\`
${commitLog || "no commits in range"}
\`\`\`

### Files Changed (${fileCount})
\`\`\`
${diffFiles || "none"}
\`\`\`

### Stats
\`\`\`
${diffStat || "no changes"}
\`\`\``,
        }],
      };
    }
  );
}
