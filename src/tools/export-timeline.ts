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

/** Get project directories to search based on scope */
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

interface EventSummary {
  total: number;
  byType: Record<string, number>;
  byDay: Map<string, number>;
  corrections: number;
  errors: number;
  avgEventsPerDay: number;
  activeDays: number;
}

function summarizeEvents(events: any[]): EventSummary {
  const byType: Record<string, number> = {};
  const byDay = new Map<string, number>();
  let corrections = 0;
  let errors = 0;

  for (const e of events) {
    byType[e.type] = (byType[e.type] || 0) + 1;
    const day = e.timestamp
      ? new Date(e.timestamp).toISOString().slice(0, 10)
      : "unknown";
    byDay.set(day, (byDay.get(day) || 0) + 1);
    if (e.type === "correction") corrections++;
    if (e.type === "error") errors++;
  }

  const activeDays = byDay.size;
  return {
    total: events.length,
    byType,
    byDay,
    corrections,
    errors,
    avgEventsPerDay: activeDays > 0 ? Math.round(events.length / activeDays) : 0,
    activeDays,
  };
}

function formatReport(
  events: any[],
  summary: EventSummary,
  params: {
    scope: string;
    project?: string;
    since?: string;
    until?: string;
    format: string;
  }
): string {
  const lines: string[] = [];
  const now = new Date().toISOString().slice(0, 10);
  const proj = params.project || params.scope;

  // Title
  lines.push(`# Session Report: ${proj}`);
  lines.push(`_Generated ${now}_`);
  lines.push("");

  // Date range
  const sortedDays = [...summary.byDay.keys()].sort();
  if (sortedDays.length > 0) {
    lines.push(
      `**Period:** ${sortedDays[0]} → ${sortedDays[sortedDays.length - 1]} (${summary.activeDays} active days)`
    );
  }
  lines.push("");

  // Summary stats
  lines.push("## Summary");
  lines.push("");
  lines.push(`| Metric | Value |`);
  lines.push(`|--------|-------|`);
  lines.push(`| Total events | ${summary.total} |`);
  lines.push(`| Active days | ${summary.activeDays} |`);
  lines.push(`| Avg events/day | ${summary.avgEventsPerDay} |`);
  lines.push(`| Corrections | ${summary.corrections} |`);
  lines.push(`| Errors | ${summary.errors} |`);
  lines.push("");

  // Event breakdown
  lines.push("## Event Breakdown");
  lines.push("");
  const typeEntries = Object.entries(summary.byType).sort(
    ([, a], [, b]) => b - a
  );
  for (const [type, count] of typeEntries) {
    const pct = ((count / summary.total) * 100).toFixed(1);
    lines.push(`- **${type}**: ${count} (${pct}%)`);
  }
  lines.push("");

  // Daily activity
  lines.push("## Daily Activity");
  lines.push("");
  const daysSorted = [...summary.byDay.entries()].sort(([a], [b]) =>
    b.localeCompare(a)
  );
  for (const [day, count] of daysSorted) {
    const bar = "█".repeat(Math.min(count, 40));
    lines.push(`- ${day}: ${bar} ${count}`);
  }
  lines.push("");

  // Correction log (if any)
  if (summary.corrections > 0) {
    lines.push("## Corrections");
    lines.push("");
    const corrections = events.filter((e) => e.type === "correction");
    for (const c of corrections.slice(0, 20)) {
      const time = c.timestamp
        ? new Date(c.timestamp).toISOString().slice(0, 16).replace("T", " ")
        : "??";
      const content = (c.content || c.summary || "")
        .slice(0, 150)
        .replace(/\n/g, " ");
      lines.push(`- **${time}**: ${content}`);
    }
    if (corrections.length > 20) {
      lines.push(`- _...and ${corrections.length - 20} more_`);
    }
    lines.push("");
  }

  // Error log (if any)
  if (summary.errors > 0) {
    lines.push("## Errors");
    lines.push("");
    const errors = events.filter((e) => e.type === "error");
    for (const e of errors.slice(0, 20)) {
      const time = e.timestamp
        ? new Date(e.timestamp).toISOString().slice(0, 16).replace("T", " ")
        : "??";
      const content = (e.content || e.summary || "")
        .slice(0, 150)
        .replace(/\n/g, " ");
      lines.push(`- **${time}**: ${content}`);
    }
    if (errors.length > 20) {
      lines.push(`- _...and ${errors.length - 20} more_`);
    }
    lines.push("");
  }

  // Recent commits
  const commits = events.filter((e) => e.type === "commit");
  if (commits.length > 0) {
    lines.push("## Recent Commits");
    lines.push("");
    for (const c of commits.slice(-20)) {
      const time = c.timestamp
        ? new Date(c.timestamp).toISOString().slice(0, 16).replace("T", " ")
        : "??";
      const hash = c.commit_hash ? c.commit_hash.slice(0, 7) : "???????";
      const msg = (c.content || c.summary || "")
        .slice(0, 100)
        .replace(/\n/g, " ");
      lines.push(`- \`${hash}\` ${time} — ${msg}`);
    }
    lines.push("");
  }

  // Prompt quality trend (ratio of corrections to prompts)
  const prompts = summary.byType["prompt"] || 0;
  if (prompts > 0) {
    const correctionRate = ((summary.corrections / prompts) * 100).toFixed(1);
    lines.push("## Prompt Quality");
    lines.push("");
    lines.push(`- Total prompts: ${prompts}`);
    lines.push(`- Correction rate: ${correctionRate}%`);
    if (parseFloat(correctionRate) < 5) {
      lines.push(`- Assessment: ✅ Excellent — very few corrections needed`);
    } else if (parseFloat(correctionRate) < 15) {
      lines.push(`- Assessment: 🟡 Good — some room for improvement`);
    } else {
      lines.push(
        `- Assessment: 🔴 High correction rate — consider more detailed prompts`
      );
    }
    lines.push("");
  }

  lines.push("---");
  lines.push("_Report generated by preflight-dev export_timeline_");

  return lines.join("\n");
}

export function registerExportTimeline(server: McpServer) {
  server.tool(
    "export_timeline",
    "Generate a markdown session report with summary stats, daily activity, prompt quality trends, error/correction logs, and commit history. Use for weekly summaries or project retrospectives.",
    {
      scope: z
        .enum(["current", "related", "all"])
        .default("current")
        .describe("Search scope"),
      project: z
        .string()
        .optional()
        .describe("Filter to a specific project (overrides scope)"),
      since: z
        .string()
        .optional()
        .describe(
          'Start date (ISO or relative like "7days", "2weeks", "1month")'
        ),
      until: z.string().optional().describe("End date (ISO or relative)"),
      format: z
        .enum(["markdown"])
        .default("markdown")
        .describe("Output format (markdown for now, PDF planned)"),
    },
    async (params) => {
      const since = params.since
        ? parseRelativeDate(params.since)
        : parseRelativeDate("7days");
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
              type: "text" as const,
              text: `No projects found for scope "${params.scope}". Onboard a project first.`,
            },
          ],
        };
      }

      // Fetch all events (high limit for report generation)
      const events = await getTimeline({
        project_dirs: projectDirs,
        project: undefined,
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
              text: "No events found for the given time range. Try a wider date range.",
            },
          ],
        };
      }

      const summary = summarizeEvents(events);
      const report = formatReport(events, summary, params);

      return {
        content: [{ type: "text" as const, text: report }],
      };
    }
  );
}
