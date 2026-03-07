import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getTimeline, listIndexedProjects } from "../lib/timeline-db.js";
import { getRelatedProjects } from "../lib/config.js";
import type { SearchScope } from "../types.js";

const RELATIVE_DATE_RE = /^(\d+)(days?|weeks?|months?|years?)$/;

export function parseRelativeDate(input: string): string {
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

interface ReportStats {
  totalEvents: number;
  byType: Record<string, number>;
  byDay: Map<string, number>;
  corrections: number;
  errors: number;
  commits: number;
  avgEventsPerDay: number;
}

export function computeStats(events: any[]): ReportStats {
  const byType: Record<string, number> = {};
  const byDay = new Map<string, number>();
  let corrections = 0;
  let errors = 0;
  let commits = 0;

  for (const e of events) {
    byType[e.type] = (byType[e.type] || 0) + 1;
    const day = e.timestamp
      ? new Date(e.timestamp).toISOString().slice(0, 10)
      : "unknown";
    byDay.set(day, (byDay.get(day) || 0) + 1);
    if (e.type === "correction") corrections++;
    if (e.type === "error") errors++;
    if (e.type === "commit") commits++;
  }

  return {
    totalEvents: events.length,
    byType,
    byDay,
    corrections,
    errors,
    commits,
    avgEventsPerDay: byDay.size > 0 ? events.length / byDay.size : 0,
  };
}

export function generateMarkdownReport(
  events: any[],
  stats: ReportStats,
  opts: { project: string; since?: string; until?: string; period: string }
): string {
  const lines: string[] = [];
  const now = new Date().toISOString().slice(0, 10);

  lines.push(`# Session Report: ${opts.project}`);
  lines.push(`_Generated ${now} | Period: ${opts.period}_`);
  lines.push("");

  // Summary
  lines.push("## Summary");
  lines.push("");
  lines.push(`| Metric | Value |`);
  lines.push(`|--------|-------|`);
  lines.push(`| Total events | ${stats.totalEvents} |`);
  lines.push(`| Days active | ${stats.byDay.size} |`);
  lines.push(
    `| Avg events/day | ${stats.avgEventsPerDay.toFixed(1)} |`
  );
  lines.push(`| Commits | ${stats.commits} |`);
  lines.push(`| Corrections | ${stats.corrections} |`);
  lines.push(`| Errors | ${stats.errors} |`);
  lines.push("");

  // Activity by type
  lines.push("## Activity by Type");
  lines.push("");
  lines.push("| Type | Count |");
  lines.push("|------|-------|");
  const sortedTypes = Object.entries(stats.byType).sort(
    ([, a], [, b]) => b - a
  );
  for (const [type, count] of sortedTypes) {
    lines.push(`| ${TYPE_LABELS[type] || type} | ${count} |`);
  }
  lines.push("");

  // Daily activity
  lines.push("## Daily Activity");
  lines.push("");
  const sortedDays = [...stats.byDay.entries()].sort(([a], [b]) =>
    b.localeCompare(a)
  );
  for (const [day, count] of sortedDays) {
    const bar = "█".repeat(Math.min(count, 40));
    lines.push(`- **${day}**: ${count} events ${bar}`);
  }
  lines.push("");

  // Corrections (prompt quality signal)
  if (stats.corrections > 0) {
    lines.push("## Corrections");
    lines.push("");
    const corrections = events.filter((e) => e.type === "correction");
    for (const c of corrections.slice(0, 20)) {
      const time = c.timestamp
        ? new Date(c.timestamp).toISOString().slice(0, 16).replace("T", " ")
        : "unknown";
      const content = (c.content || "").slice(0, 200).replace(/\n/g, " ");
      lines.push(`- **${time}**: ${content}`);
    }
    if (corrections.length > 20) {
      lines.push(`- _...and ${corrections.length - 20} more_`);
    }
    lines.push("");
  }

  // Commits
  if (stats.commits > 0) {
    lines.push("## Commits");
    lines.push("");
    const commitEvents = events.filter((e) => e.type === "commit");
    for (const c of commitEvents.slice(0, 30)) {
      const time = c.timestamp
        ? new Date(c.timestamp).toISOString().slice(0, 16).replace("T", " ")
        : "unknown";
      const hash = c.commit_hash ? c.commit_hash.slice(0, 7) : "";
      const msg = (c.content || c.summary || "").slice(0, 120).replace(/\n/g, " ");
      lines.push(`- \`${hash}\` ${time} — ${msg}`);
    }
    if (commitEvents.length > 30) {
      lines.push(`- _...and ${commitEvents.length - 30} more_`);
    }
    lines.push("");
  }

  // Errors
  if (stats.errors > 0) {
    lines.push("## Errors");
    lines.push("");
    const errorEvents = events.filter((e) => e.type === "error");
    for (const e of errorEvents.slice(0, 10)) {
      const time = e.timestamp
        ? new Date(e.timestamp).toISOString().slice(0, 16).replace("T", " ")
        : "unknown";
      const content = (e.content || "").slice(0, 200).replace(/\n/g, " ");
      lines.push(`- **${time}**: ${content}`);
    }
    if (errorEvents.length > 10) {
      lines.push(`- _...and ${errorEvents.length - 10} more_`);
    }
    lines.push("");
  }

  lines.push("---");
  lines.push("_Report generated by preflight `export_timeline` tool_");

  return lines.join("\n");
}

export function registerExportTimeline(server: McpServer) {
  server.tool(
    "export_timeline",
    "Export timeline data as a structured markdown report with statistics, daily activity, corrections, commits, and errors. Use for weekly summaries and prompt quality trend analysis.",
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
        .enum(["day", "week", "month", "quarter"])
        .default("week")
        .describe("Report period — how far back to look"),
      since: z
        .string()
        .optional()
        .describe(
          "Override start date (ISO or relative like '7days', '2weeks')"
        ),
      until: z.string().optional().describe("Override end date"),
      branch: z.string().optional(),
      author: z
        .string()
        .optional()
        .describe("Filter commits by author (partial match)"),
    },
    async (params) => {
      // Determine date range from period
      let since = params.since;
      if (!since) {
        switch (params.period) {
          case "day":
            since = "1day";
            break;
          case "week":
            since = "7days";
            break;
          case "month":
            since = "30days";
            break;
          case "quarter":
            since = "90days";
            break;
        }
      }
      const parsedSince = since ? parseRelativeDate(since) : undefined;
      const parsedUntil = params.until
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
              text: `No projects found for scope "${params.scope}". Set CLAUDE_PROJECT_DIR or onboard a project first.`,
            },
          ],
        };
      }

      // Fetch all events (high limit for reports)
      let events = await getTimeline({
        project_dirs: projectDirs,
        project: undefined,
        branch: params.branch,
        since: parsedSince,
        until: parsedUntil,
        limit: 5000,
        offset: 0,
      });

      // Post-filter by author
      if (params.author) {
        const authorLower = params.author.toLowerCase();
        events = events.filter((e: any) => {
          if (e.type !== "commit") return true;
          try {
            const meta = JSON.parse(e.metadata || "{}");
            return (meta.author || "").toLowerCase().includes(authorLower);
          } catch {
            return true;
          }
        });
      }

      if (events.length === 0) {
        return {
          content: [
            {
              type: "text" as const,
              text: "No events found for the given filters. Try a broader period or scope.",
            },
          ],
        };
      }

      const stats = computeStats(events);
      const projectLabel =
        params.project || (params.scope === "current" ? "current project" : params.scope);
      const periodLabel = params.since || params.period;

      const report = generateMarkdownReport(events, stats, {
        project: projectLabel,
        since: parsedSince,
        until: parsedUntil,
        period: periodLabel,
      });

      return {
        content: [{ type: "text" as const, text: report }],
      };
    }
  );
}
