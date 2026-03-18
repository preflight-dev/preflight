import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getTimeline, listIndexedProjects } from "../lib/timeline-db.js";
import { getRelatedProjects } from "../lib/config.js";
import type { SearchScope } from "../types.js";

const RELATIVE_DATE_RE = /^(\d+)(days?|weeks?|months?|years?)$/;

function parseRelativeDate(input: string): string {
  const match = input.match(RELATIVE_DATE_RE);
  if (!match) return input;
  const [, numStr, unit] = match;
  const num = parseInt(numStr, 10);
  const d = new Date();
  if (unit.startsWith("day")) d.setDate(d.getDate() - num);
  else if (unit.startsWith("week")) d.setDate(d.getDate() - num * 7);
  else if (unit.startsWith("month")) d.setMonth(d.getMonth() - num);
  else if (unit.startsWith("year")) d.setFullYear(d.getFullYear() - num);
  return d.toISOString();
}

async function getSearchProjects(scope: SearchScope): Promise<string[]> {
  const currentProject = process.env.CLAUDE_PROJECT_DIR;
  switch (scope) {
    case "current":
      return currentProject ? [currentProject] : [];
    case "related": {
      const related = getRelatedProjects();
      return currentProject ? [currentProject, ...related] : related;
    }
    case "all": {
      const projects = await listIndexedProjects();
      return projects.map((p) => p.project);
    }
    default:
      return currentProject ? [currentProject] : [];
  }
}

const TYPE_ICONS: Record<string, string> = {
  prompt: "💬",
  assistant: "🤖",
  tool_call: "🔧",
  correction: "❌",
  commit: "📦",
  compaction: "🗜️",
  sub_agent_spawn: "🚀",
  error: "⚠️",
};

interface EventRecord {
  timestamp: string;
  type: string;
  content?: string;
  summary?: string;
  commit_hash?: string;
  tool_name?: string;
  metadata?: string;
}

function formatDuration(ms: number): string {
  const hours = Math.floor(ms / 3_600_000);
  const mins = Math.floor((ms % 3_600_000) / 60_000);
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

export function registerExportTimeline(server: McpServer) {
  server.tool(
    "export_timeline",
    "Generate a markdown report from timeline data. Includes event breakdown, daily summaries, prompt quality trends, and correction patterns. Great for weekly standups and retrospectives.",
    {
      scope: z
        .enum(["current", "related", "all"])
        .default("current")
        .describe("Search scope"),
      project: z.string().optional().describe("Filter to specific project"),
      since: z
        .string()
        .optional()
        .describe("Start date (ISO or relative like '7days', '1week')"),
      until: z.string().optional().describe("End date"),
      branch: z.string().optional(),
      format: z
        .enum(["summary", "detailed", "standup"])
        .default("summary")
        .describe(
          "Report format: summary (overview + stats), detailed (full event log), standup (brief daily bullets)"
        ),
    },
    async (params) => {
      const since = params.since
        ? parseRelativeDate(params.since)
        : parseRelativeDate("7days");
      const until = params.until
        ? parseRelativeDate(params.until)
        : undefined;

      let projectDirs: string[];
      if (params.project) {
        projectDirs = [params.project];
      } else {
        projectDirs = await getSearchProjects(params.scope);
      }

      if (projectDirs.length === 0) {
        return {
          content: [
            {
              type: "text" as const,
              text: `# Timeline Report\n\n_No projects found for scope "${params.scope}"._`,
            },
          ],
        };
      }

      const events = (await getTimeline({
        project_dirs: projectDirs,
        project: undefined,
        branch: params.branch,
        since,
        until,
        type: undefined,
        limit: 1000,
        offset: 0,
      })) as EventRecord[];

      if (events.length === 0) {
        return {
          content: [
            {
              type: "text" as const,
              text: `# Timeline Report\n\n_No events found for the given time range._`,
            },
          ],
        };
      }

      // Compute stats
      const typeCounts: Record<string, number> = {};
      const dayBuckets = new Map<string, EventRecord[]>();
      let earliest = Infinity;
      let latest = -Infinity;

      for (const e of events) {
        typeCounts[e.type] = (typeCounts[e.type] || 0) + 1;
        const day = e.timestamp
          ? new Date(e.timestamp).toISOString().slice(0, 10)
          : "unknown";
        if (!dayBuckets.has(day)) dayBuckets.set(day, []);
        dayBuckets.get(day)!.push(e);

        if (e.timestamp) {
          const t = new Date(e.timestamp).getTime();
          if (t < earliest) earliest = t;
          if (t > latest) latest = t;
        }
      }

      const sortedDays = [...dayBuckets.keys()].sort().reverse();
      const proj = params.project || "all projects";
      const dateRange =
        sortedDays.length > 1
          ? `${sortedDays[sortedDays.length - 1]} → ${sortedDays[0]}`
          : sortedDays[0];

      const lines: string[] = [];

      // Header
      lines.push(`# Timeline Report: ${proj}`);
      lines.push(`**Period:** ${dateRange}  `);
      lines.push(
        `**Total events:** ${events.length} across ${sortedDays.length} day(s)  `
      );
      if (earliest !== Infinity && latest !== -Infinity) {
        lines.push(`**Span:** ${formatDuration(latest - earliest)}`);
      }
      lines.push("");

      // Event breakdown
      lines.push("## Event Breakdown");
      lines.push("");
      const sortedTypes = Object.entries(typeCounts).sort(
        ([, a], [, b]) => b - a
      );
      for (const [type, count] of sortedTypes) {
        const icon = TYPE_ICONS[type] || "❓";
        const pct = ((count / events.length) * 100).toFixed(0);
        lines.push(`- ${icon} **${type}**: ${count} (${pct}%)`);
      }
      lines.push("");

      // Correction analysis
      const corrections = events.filter((e) => e.type === "correction");
      if (corrections.length > 0) {
        lines.push("## Corrections & Lessons");
        lines.push("");
        lines.push(
          `⚠️ **${corrections.length} correction(s)** logged in this period.`
        );
        lines.push("");
        for (const c of corrections.slice(0, 10)) {
          const day = c.timestamp
            ? new Date(c.timestamp).toISOString().slice(0, 10)
            : "unknown";
          const text = (c.content || c.summary || "").slice(0, 200);
          lines.push(`- **${day}**: ${text}`);
        }
        lines.push("");
      }

      // Commit summary
      const commits = events.filter((e) => e.type === "commit");
      if (commits.length > 0) {
        lines.push("## Commits");
        lines.push("");
        lines.push(`📦 **${commits.length} commit(s)** in this period.`);
        lines.push("");
        for (const c of commits.slice(0, 20)) {
          const hash = c.commit_hash ? c.commit_hash.slice(0, 7) : "???????";
          const msg = (c.content || c.summary || "").slice(0, 120);
          const day = c.timestamp
            ? new Date(c.timestamp).toISOString().slice(0, 10)
            : "";
          lines.push(`- \`${hash}\` ${msg} _(${day})_`);
        }
        lines.push("");
      }

      // Format-specific sections
      if (params.format === "standup") {
        lines.push("## Daily Standup Notes");
        lines.push("");
        for (const day of sortedDays.slice(0, 7)) {
          const dayEvents = dayBuckets.get(day)!;
          const dayCommits = dayEvents.filter((e) => e.type === "commit");
          const dayCorrections = dayEvents.filter(
            (e) => e.type === "correction"
          );
          const dayErrors = dayEvents.filter((e) => e.type === "error");

          lines.push(`### ${day}`);
          lines.push(
            `- ${dayEvents.length} events, ${dayCommits.length} commits`
          );
          if (dayCorrections.length > 0) {
            lines.push(`- ❌ ${dayCorrections.length} correction(s)`);
          }
          if (dayErrors.length > 0) {
            lines.push(`- ⚠️ ${dayErrors.length} error(s)`);
          }
          // Top commits
          for (const c of dayCommits.slice(0, 3)) {
            const msg = (c.content || c.summary || "").slice(0, 80);
            lines.push(`  - 📦 ${msg}`);
          }
          lines.push("");
        }
      } else if (params.format === "detailed") {
        lines.push("## Full Event Log");
        lines.push("");
        for (const day of sortedDays) {
          lines.push(`### ${day}`);
          const dayEvents = dayBuckets.get(day)!;
          dayEvents.sort((a, b) => {
            const ta = a.timestamp ? new Date(a.timestamp).getTime() : 0;
            const tb = b.timestamp ? new Date(b.timestamp).getTime() : 0;
            return ta - tb;
          });
          for (const event of dayEvents) {
            const time = event.timestamp
              ? new Date(event.timestamp).toISOString().slice(11, 16)
              : "??:??";
            const icon = TYPE_ICONS[event.type] || "❓";
            const content = (event.content || event.summary || "")
              .slice(0, 150)
              .replace(/\n/g, " ");
            lines.push(`- ${time} ${icon} ${content}`);
          }
          lines.push("");
        }
      }

      // Prompt quality signal
      const prompts = typeCounts["prompt"] || 0;
      const corrections_n = typeCounts["correction"] || 0;
      if (prompts > 0) {
        const correctionRate = ((corrections_n / prompts) * 100).toFixed(1);
        lines.push("## Quality Signal");
        lines.push("");
        lines.push(
          `- **Correction rate:** ${correctionRate}% (${corrections_n}/${prompts} prompts needed correction)`
        );
        if (parseFloat(correctionRate) < 5) {
          lines.push("- ✅ Low correction rate — prompts are clear and effective");
        } else if (parseFloat(correctionRate) < 15) {
          lines.push("- 🟡 Moderate correction rate — consider reviewing common correction patterns");
        } else {
          lines.push("- 🔴 High correction rate — recommend running `check_patterns` for insights");
        }
        lines.push("");
      }

      lines.push("---");
      lines.push(
        `_Generated by preflight export_timeline • ${new Date().toISOString().slice(0, 16)}_`
      );

      return {
        content: [{ type: "text" as const, text: lines.join("\n") }],
      };
    }
  );
}
