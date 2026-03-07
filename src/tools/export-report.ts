// =============================================================================
// export_report — Generate markdown session reports from timeline data
// Closes #5: Export timeline to markdown/PDF reports
// =============================================================================

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getTimeline, listIndexedProjects } from "../lib/timeline-db.js";
import { getRelatedProjects } from "../lib/config.js";
import { writeFile, mkdir } from "fs/promises";
import { join } from "path";
import { homedir } from "os";
import type { SearchScope } from "../types.js";

// ── Helpers ─────────────────────────────────────────────────────────────────

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

// ── Stats ───────────────────────────────────────────────────────────────────

interface ReportStats {
  totalEvents: number;
  byType: Record<string, number>;
  byDay: Map<string, number>;
  activeDays: number;
  avgEventsPerDay: number;
  corrections: number;
  errors: number;
  commits: number;
  promptCount: number;
}

function computeStats(events: any[]): ReportStats {
  const byType: Record<string, number> = {};
  const byDay = new Map<string, number>();

  for (const e of events) {
    byType[e.type] = (byType[e.type] || 0) + 1;
    const day = e.timestamp
      ? new Date(e.timestamp).toISOString().slice(0, 10)
      : "unknown";
    byDay.set(day, (byDay.get(day) || 0) + 1);
  }

  const activeDays = byDay.size;
  return {
    totalEvents: events.length,
    byType,
    byDay,
    activeDays,
    avgEventsPerDay: activeDays > 0 ? Math.round(events.length / activeDays) : 0,
    corrections: byType["correction"] || 0,
    errors: byType["error"] || 0,
    commits: byType["commit"] || 0,
    promptCount: byType["prompt"] || 0,
  };
}

// ── Report Rendering ────────────────────────────────────────────────────────

function renderMarkdown(
  events: any[],
  stats: ReportStats,
  opts: { project: string; since?: string; until?: string; scope: string }
): string {
  const now = new Date().toISOString().slice(0, 10);
  const dateRange =
    opts.since && opts.until
      ? `${opts.since.slice(0, 10)} — ${opts.until.slice(0, 10)}`
      : opts.since
        ? `Since ${opts.since.slice(0, 10)}`
        : opts.until
          ? `Until ${opts.until.slice(0, 10)}`
          : "All time";

  const lines: string[] = [
    `# Session Report: ${opts.project}`,
    `> Generated ${now} | Scope: ${opts.scope} | Period: ${dateRange}`,
    "",
    "## Summary",
    "",
    `| Metric | Value |`,
    `|--------|-------|`,
    `| Total events | ${stats.totalEvents} |`,
    `| Active days | ${stats.activeDays} |`,
    `| Avg events/day | ${stats.avgEventsPerDay} |`,
    `| Prompts | ${stats.promptCount} |`,
    `| Commits | ${stats.commits} |`,
    `| Corrections | ${stats.corrections} |`,
    `| Errors | ${stats.errors} |`,
    "",
  ];

  // Event type breakdown
  lines.push("## Event Breakdown", "");
  for (const [type, count] of Object.entries(stats.byType).sort(
    (a, b) => b[1] - a[1]
  )) {
    const icon = TYPE_ICONS[type] || "❓";
    const pct = ((count / stats.totalEvents) * 100).toFixed(1);
    lines.push(`- ${icon} **${type}**: ${count} (${pct}%)`);
  }
  lines.push("");

  // Activity heatmap (simple text version)
  lines.push("## Daily Activity", "");
  const sortedDays = [...stats.byDay.entries()].sort((a, b) =>
    a[0].localeCompare(b[0])
  );
  for (const [day, count] of sortedDays) {
    const bar = "█".repeat(Math.min(count, 40));
    lines.push(`- ${day}: ${bar} (${count})`);
  }
  lines.push("");

  // Correction trends (if any)
  if (stats.corrections > 0) {
    lines.push("## Corrections", "");
    const corrections = events.filter((e) => e.type === "correction");
    for (const c of corrections.slice(0, 20)) {
      const time = c.timestamp
        ? new Date(c.timestamp).toISOString().slice(0, 16).replace("T", " ")
        : "??";
      const content = (c.content || "").slice(0, 100).replace(/\n/g, " ");
      lines.push(`- \`${time}\` ${content}`);
    }
    lines.push("");
  }

  // Recent commits
  if (stats.commits > 0) {
    lines.push("## Recent Commits", "");
    const commits = events.filter((e) => e.type === "commit");
    for (const c of commits.slice(-20)) {
      const time = c.timestamp
        ? new Date(c.timestamp).toISOString().slice(0, 16).replace("T", " ")
        : "??";
      const hash = c.commit_hash ? c.commit_hash.slice(0, 7) : "???????";
      const msg = (c.content || "").slice(0, 80).replace(/\n/g, " ");
      lines.push(`- \`${time}\` \`${hash}\` ${msg}`);
    }
    lines.push("");
  }

  // Prompt quality signal: correction rate
  if (stats.promptCount > 0) {
    const correctionRate = (
      (stats.corrections / stats.promptCount) *
      100
    ).toFixed(1);
    lines.push("## Prompt Quality Signal", "");
    lines.push(
      `- Correction rate: **${correctionRate}%** (${stats.corrections} corrections / ${stats.promptCount} prompts)`
    );
    if (parseFloat(correctionRate) < 5) {
      lines.push("- 🟢 Excellent — very few corrections needed");
    } else if (parseFloat(correctionRate) < 15) {
      lines.push("- 🟡 Good — some room for improvement");
    } else {
      lines.push(
        "- 🔴 High correction rate — consider reviewing prompt patterns"
      );
    }
    lines.push("");
  }

  lines.push("---", `_Report generated by preflight export_report_`);
  return lines.join("\n");
}

// ── Tool Registration ───────────────────────────────────────────────────────

export function registerExportReport(server: McpServer) {
  server.tool(
    "export_report",
    "Generate a markdown session report from timeline data. Includes activity summary, event breakdown, daily activity chart, correction trends, and prompt quality signals.",
    {
      scope: z
        .enum(["current", "related", "all"])
        .default("current")
        .describe("Search scope"),
      project: z
        .string()
        .optional()
        .describe("Filter to specific project (overrides scope)"),
      since: z
        .string()
        .optional()
        .describe(
          'Start date — ISO string or relative like "7days", "2weeks", "1month"'
        ),
      until: z.string().optional().describe("End date"),
      save: z
        .boolean()
        .default(false)
        .describe(
          "Save the report to ~/.preflight/reports/ and return the path"
        ),
    },
    async (params) => {
      const since = params.since
        ? parseRelativeDate(params.since)
        : undefined;
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
              text: `No projects found for scope "${params.scope}". Ensure CLAUDE_PROJECT_DIR is set or projects are onboarded.`,
            },
          ],
        };
      }

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
              text: "No events found for the given filters.",
            },
          ],
        };
      }

      const stats = computeStats(events);
      const projectLabel =
        params.project || (params.scope === "current" ? "current" : params.scope);
      const markdown = renderMarkdown(events, stats, {
        project: projectLabel,
        since,
        until,
        scope: params.scope,
      });

      if (params.save) {
        const reportsDir = join(homedir(), ".preflight", "reports");
        await mkdir(reportsDir, { recursive: true });
        const timestamp = new Date().toISOString().slice(0, 10);
        const safeName = projectLabel.replace(/[^a-zA-Z0-9-_]/g, "_");
        const filename = `report-${safeName}-${timestamp}.md`;
        const filepath = join(reportsDir, filename);
        await writeFile(filepath, markdown, "utf-8");
        return {
          content: [
            {
              type: "text" as const,
              text: `Report saved to \`${filepath}\`\n\n${markdown}`,
            },
          ],
        };
      }

      return {
        content: [{ type: "text" as const, text: markdown }],
      };
    }
  );
}
