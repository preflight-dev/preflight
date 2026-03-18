import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getTimeline, listIndexedProjects } from "../lib/timeline-db.js";
import { getRelatedProjects } from "../lib/config.js";
import type { SearchScope } from "../types.js";

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

const TYPE_LABELS: Record<string, string> = {
  prompt: "Prompt",
  assistant: "Response",
  tool_call: "Tool Call",
  correction: "Correction",
  commit: "Commit",
  compaction: "Compaction",
  sub_agent_spawn: "Sub-agent Spawn",
  error: "Error",
};

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

interface DaySummary {
  date: string;
  events: any[];
  promptCount: number;
  commitCount: number;
  errorCount: number;
  correctionCount: number;
  toolCallCount: number;
}

function summarizeDay(date: string, events: any[]): DaySummary {
  return {
    date,
    events,
    promptCount: events.filter((e) => e.type === "prompt").length,
    commitCount: events.filter((e) => e.type === "commit").length,
    errorCount: events.filter((e) => e.type === "error").length,
    correctionCount: events.filter((e) => e.type === "correction").length,
    toolCallCount: events.filter((e) => e.type === "tool_call").length,
  };
}

function formatMarkdown(
  summaries: DaySummary[],
  projectName: string,
  since?: string,
  until?: string,
): string {
  const lines: string[] = [];
  const totalEvents = summaries.reduce((s, d) => s + d.events.length, 0);
  const totalPrompts = summaries.reduce((s, d) => s + d.promptCount, 0);
  const totalCommits = summaries.reduce((s, d) => s + d.commitCount, 0);
  const totalErrors = summaries.reduce((s, d) => s + d.errorCount, 0);
  const totalCorrections = summaries.reduce(
    (s, d) => s + d.correctionCount,
    0,
  );

  // Header
  lines.push(`# Session Report: ${projectName}`);
  lines.push("");
  const dateRange =
    since && until
      ? `${since} to ${until}`
      : summaries.length > 0
        ? `${summaries[summaries.length - 1].date} to ${summaries[0].date}`
        : "N/A";
  lines.push(`**Period:** ${dateRange}`);
  lines.push(`**Generated:** ${new Date().toISOString().slice(0, 10)}`);
  lines.push("");

  // Summary stats
  lines.push("## Summary");
  lines.push("");
  lines.push(`| Metric | Count |`);
  lines.push(`|--------|-------|`);
  lines.push(`| Total Events | ${totalEvents} |`);
  lines.push(`| Days Active | ${summaries.length} |`);
  lines.push(`| Prompts | ${totalPrompts} |`);
  lines.push(`| Commits | ${totalCommits} |`);
  lines.push(`| Corrections | ${totalCorrections} |`);
  lines.push(`| Errors | ${totalErrors} |`);
  lines.push("");

  // Quality indicators
  if (totalPrompts > 0) {
    const correctionRate = ((totalCorrections / totalPrompts) * 100).toFixed(1);
    const errorRate = ((totalErrors / totalPrompts) * 100).toFixed(1);
    lines.push("## Quality Indicators");
    lines.push("");
    lines.push(
      `- **Correction rate:** ${correctionRate}% (${totalCorrections} corrections / ${totalPrompts} prompts)`,
    );
    lines.push(
      `- **Error rate:** ${errorRate}% (${totalErrors} errors / ${totalPrompts} prompts)`,
    );
    lines.push(
      `- **Avg events/day:** ${(totalEvents / summaries.length).toFixed(1)}`,
    );
    lines.push("");
  }

  // Daily breakdown
  lines.push("## Daily Breakdown");
  lines.push("");

  for (const day of summaries) {
    const badges: string[] = [];
    if (day.commitCount > 0) badges.push(`${day.commitCount} commits`);
    if (day.promptCount > 0) badges.push(`${day.promptCount} prompts`);
    if (day.errorCount > 0) badges.push(`⚠️ ${day.errorCount} errors`);
    if (day.correctionCount > 0)
      badges.push(`❌ ${day.correctionCount} corrections`);

    lines.push(`### ${day.date} (${badges.join(", ")})`);
    lines.push("");

    // Sort events chronologically within the day
    const sorted = [...day.events].sort((a, b) => {
      const ta = a.timestamp ? new Date(a.timestamp).getTime() : 0;
      const tb = b.timestamp ? new Date(b.timestamp).getTime() : 0;
      return ta - tb;
    });

    for (const event of sorted) {
      const time = event.timestamp
        ? new Date(event.timestamp).toISOString().slice(11, 16)
        : "??:??";
      const icon = TYPE_ICONS[event.type] || "❓";
      let content = (event.content || event.summary || "")
        .slice(0, 150)
        .replace(/\n/g, " ");

      if (event.type === "commit") {
        const hash = event.commit_hash
          ? `\`${event.commit_hash.slice(0, 7)}\` `
          : "";
        content = `${hash}${content}`;
      } else if (event.type === "tool_call") {
        const tool = event.tool_name || "";
        const target = content ? ` → ${content}` : "";
        content = `\`${tool}\`${target}`;
      }

      lines.push(`- **${time}** ${icon} ${content}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

export function registerExportTimeline(server: McpServer) {
  server.tool(
    "export_timeline",
    "Export timeline data as a formatted markdown report with summary statistics, quality indicators, and daily breakdowns. Useful for weekly summaries, sprint reviews, and tracking prompt quality trends.",
    {
      scope: z
        .enum(["current", "related", "all"])
        .default("current")
        .describe("Search scope"),
      project: z
        .string()
        .optional()
        .describe("Filter to a specific project (overrides scope)"),
      branch: z.string().optional(),
      since: z
        .string()
        .optional()
        .describe(
          "Start date (ISO string or relative like '7days', '2weeks', '1month')",
        ),
      until: z.string().optional().describe("End date (ISO string)"),
      type: z
        .enum([
          "prompt",
          "assistant",
          "correction",
          "commit",
          "tool_call",
          "compaction",
          "sub_agent_spawn",
          "error",
          "all",
        ])
        .default("all"),
      limit: z.number().default(500).describe("Max events to include"),
    },
    async (params) => {
      // Parse relative dates
      const since = params.since ? parseRelativeDate(params.since) : undefined;
      const until = params.until ? parseRelativeDate(params.until) : undefined;

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
              type: "text",
              text: `No projects found for scope "${params.scope}". Make sure CLAUDE_PROJECT_DIR is set or projects are onboarded.`,
            },
          ],
        };
      }

      const events = await getTimeline({
        project_dirs: projectDirs,
        branch: params.branch,
        since,
        until,
        type: params.type === "all" ? undefined : params.type,
        limit: params.limit,
        offset: 0,
      });

      if (events.length === 0) {
        return {
          content: [
            {
              type: "text",
              text: "No events found for the given filters. Nothing to export.",
            },
          ],
        };
      }

      // Group by day
      const days = new Map<string, any[]>();
      for (const event of events) {
        const day = event.timestamp
          ? new Date(event.timestamp).toISOString().slice(0, 10)
          : "unknown";
        if (!days.has(day)) days.set(day, []);
        days.get(day)!.push(event);
      }

      const sortedDays = [...days.keys()].sort().reverse();
      const summaries = sortedDays.map((day) =>
        summarizeDay(day, days.get(day)!),
      );

      const projectName =
        params.project || projectDirs[0]?.split("/").pop() || "Unknown";
      const markdown = formatMarkdown(summaries, projectName, since, until);

      return {
        content: [
          {
            type: "text",
            text: markdown,
          },
        ],
      };
    },
  );
}

// Reuse the same relative date parser from timeline-view
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
