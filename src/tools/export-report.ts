// =============================================================================
// export_report — Generate markdown session reports from timeline data
// Closes #5: Export timeline to markdown/PDF reports
// =============================================================================

import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getTimeline, listIndexedProjects } from "../lib/timeline-db.js";
import { getRelatedProjects } from "../lib/config.js";
import type { SearchScope } from "../types.js";
import { writeFile, mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";

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

interface DaySummary {
  date: string;
  prompts: number;
  corrections: number;
  commits: number;
  compactions: number;
  toolCalls: number;
  subAgents: number;
  errors: number;
  events: any[];
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

function getDateRange(period: string): { since: string; until: string; label: string } {
  const now = new Date();
  const until = now.toISOString();
  const start = new Date(now);

  switch (period) {
    case "day":
      start.setDate(start.getDate() - 1);
      return { since: start.toISOString(), until, label: "Daily Report" };
    case "week":
      start.setDate(start.getDate() - 7);
      return { since: start.toISOString(), until, label: "Weekly Report" };
    case "month":
      start.setMonth(start.getMonth() - 1);
      return { since: start.toISOString(), until, label: "Monthly Report" };
    default:
      start.setDate(start.getDate() - 7);
      return { since: start.toISOString(), until, label: "Weekly Report" };
  }
}

function groupByDay(events: any[]): DaySummary[] {
  const days = new Map<string, DaySummary>();

  for (const event of events) {
    const date = event.timestamp
      ? new Date(event.timestamp).toISOString().slice(0, 10)
      : "unknown";
    if (!days.has(date)) {
      days.set(date, {
        date,
        prompts: 0,
        corrections: 0,
        commits: 0,
        compactions: 0,
        toolCalls: 0,
        subAgents: 0,
        errors: 0,
        events: [],
      });
    }
    const day = days.get(date)!;
    day.events.push(event);

    switch (event.type) {
      case "prompt":
        day.prompts++;
        break;
      case "correction":
        day.corrections++;
        break;
      case "commit":
        day.commits++;
        break;
      case "compaction":
        day.compactions++;
        break;
      case "tool_call":
        day.toolCalls++;
        break;
      case "sub_agent_spawn":
        day.subAgents++;
        break;
      case "error":
        day.errors++;
        break;
    }
  }

  return [...days.values()].sort((a, b) => b.date.localeCompare(a.date));
}

function renderMarkdown(
  days: DaySummary[],
  label: string,
  projectName: string,
  since: string,
  until: string,
  includeTrends: boolean,
): string {
  const lines: string[] = [];
  const sinceDate = since.slice(0, 10);
  const untilDate = until.slice(0, 10);

  // Header
  lines.push(`# ${label}: ${projectName}`);
  lines.push(`> ${sinceDate} → ${untilDate}`);
  lines.push("");
  lines.push(`_Generated ${new Date().toISOString().slice(0, 16)}_`);
  lines.push("");

  // Totals
  const totals = days.reduce(
    (acc, d) => ({
      prompts: acc.prompts + d.prompts,
      corrections: acc.corrections + d.corrections,
      commits: acc.commits + d.commits,
      compactions: acc.compactions + d.compactions,
      toolCalls: acc.toolCalls + d.toolCalls,
      subAgents: acc.subAgents + d.subAgents,
      errors: acc.errors + d.errors,
      events: acc.events + d.events.length,
    }),
    {
      prompts: 0,
      corrections: 0,
      commits: 0,
      compactions: 0,
      toolCalls: 0,
      subAgents: 0,
      errors: 0,
      events: 0,
    },
  );

  lines.push("## Summary");
  lines.push("");
  lines.push(`| Metric | Count |`);
  lines.push(`|--------|-------|`);
  lines.push(`| Total events | ${totals.events} |`);
  lines.push(`| Prompts | ${totals.prompts} |`);
  lines.push(`| Corrections | ${totals.corrections} |`);
  lines.push(`| Commits | ${totals.commits} |`);
  lines.push(`| Tool calls | ${totals.toolCalls} |`);
  lines.push(`| Sub-agents | ${totals.subAgents} |`);
  lines.push(`| Compactions | ${totals.compactions} |`);
  lines.push(`| Errors | ${totals.errors} |`);
  lines.push("");

  // Correction rate
  if (totals.prompts > 0) {
    const rate = ((totals.corrections / totals.prompts) * 100).toFixed(1);
    lines.push(`**Correction rate:** ${rate}% (${totals.corrections}/${totals.prompts} prompts)`);
    lines.push("");
  }

  // Trend table (daily breakdown)
  if (includeTrends && days.length > 1) {
    lines.push("## Daily Breakdown");
    lines.push("");
    lines.push("| Date | Prompts | Corrections | Commits | Errors |");
    lines.push("|------|---------|-------------|---------|--------|");
    for (const day of days) {
      const corrMark = day.corrections > 0 ? ` ⚠️` : "";
      lines.push(
        `| ${day.date} | ${day.prompts} | ${day.corrections}${corrMark} | ${day.commits} | ${day.errors} |`,
      );
    }
    lines.push("");
  }

  // Per-day event log
  lines.push("## Event Log");
  lines.push("");

  for (const day of days) {
    lines.push(`### ${day.date}`);
    lines.push("");

    // Sort events by timestamp
    const sorted = day.events.sort((a: any, b: any) => {
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
        const hash = event.commit_hash ? event.commit_hash.slice(0, 7) : "";
        content = hash ? `\`${hash}\` ${content}` : content;
      }

      lines.push(`- ${time} ${icon} **${event.type}** — ${content}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

export function registerExportReport(server: McpServer): void {
  server.tool(
    "export_report",
    "Generate a markdown session report from timeline data. Creates weekly/daily/monthly summaries with prompt quality trends, correction rates, and activity breakdown. Optionally saves to a file.",
    {
      scope: z
        .enum(["current", "related", "all"])
        .default("current")
        .describe("Search scope"),
      project: z
        .string()
        .optional()
        .describe("Filter to a specific project (overrides scope)"),
      period: z
        .enum(["day", "week", "month"])
        .default("week")
        .describe("Report period"),
      since: z
        .string()
        .optional()
        .describe("Custom start date (ISO format, overrides period)"),
      until: z
        .string()
        .optional()
        .describe("Custom end date (ISO format, overrides period)"),
      output: z
        .string()
        .optional()
        .describe("File path to save the report (optional — returns inline if omitted)"),
      trends: z
        .boolean()
        .default(true)
        .describe("Include daily breakdown trend table"),
    },
    async (params) => {
      // Resolve date range
      const range = getDateRange(params.period);
      const since = params.since || range.since;
      const until = params.until || range.until;
      const label = params.since ? "Custom Report" : range.label;

      // Resolve projects
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
              text: `No projects found for scope "${params.scope}". Onboard a project first with \`onboard_project\`.`,
            },
          ],
        };
      }

      // Fetch all events in range (high limit for reports)
      const events = await getTimeline({
        project_dirs: projectDirs,
        since,
        until,
        limit: 5000,
        offset: 0,
      });

      if (events.length === 0) {
        return {
          content: [
            {
              type: "text" as const,
              text: `No events found for the period ${since.slice(0, 10)} to ${until.slice(0, 10)}. Make sure the project is onboarded.`,
            },
          ],
        };
      }

      const projectName = params.project || "All Projects";
      const days = groupByDay(events);
      const markdown = renderMarkdown(days, label, projectName, since, until, params.trends);

      // Optionally save to file
      if (params.output) {
        const outputPath = resolve(params.output);
        const dir = outputPath.substring(0, outputPath.lastIndexOf("/"));
        if (dir) {
          await mkdir(dir, { recursive: true });
        }
        await writeFile(outputPath, markdown, "utf-8");
        return {
          content: [
            {
              type: "text" as const,
              text: `Report saved to \`${outputPath}\`\n\n${markdown}`,
            },
          ],
        };
      }

      return {
        content: [{ type: "text" as const, text: markdown }],
      };
    },
  );
}
