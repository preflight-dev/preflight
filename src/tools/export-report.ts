// =============================================================================
// export_report — Generate markdown session reports from timeline data
// Addresses: https://github.com/TerminalGravity/preflight/issues/5
// =============================================================================

import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getTimeline, listIndexedProjects } from "../lib/timeline-db.js";
import { getRelatedProjects } from "../lib/config.js";
import type { SearchScope } from "../types.js";
import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";

// ── Helpers ────────────────────────────────────────────────────────────────

function parseRelativeDate(input: string): string {
  const match = input.match(/^(\d+)(days?|weeks?|months?)$/);
  if (!match) return input;
  const [, numStr, unit] = match;
  const num = parseInt(numStr, 10);
  const d = new Date();
  if (unit.startsWith("day")) d.setDate(d.getDate() - num);
  else if (unit.startsWith("week")) d.setDate(d.getDate() - num * 7);
  else if (unit.startsWith("month")) d.setMonth(d.getMonth() - num);
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

interface EventStats {
  total: number;
  byType: Record<string, number>;
  byDay: Record<string, number>;
  corrections: number;
  errors: number;
  commits: number;
  prompts: number;
  toolCalls: number;
}

function computeStats(events: any[]): EventStats {
  const stats: EventStats = {
    total: events.length,
    byType: {},
    byDay: {},
    corrections: 0,
    errors: 0,
    commits: 0,
    prompts: 0,
    toolCalls: 0,
  };

  for (const e of events) {
    // By type
    stats.byType[e.type] = (stats.byType[e.type] || 0) + 1;

    // By day
    const day = e.timestamp
      ? new Date(e.timestamp).toISOString().slice(0, 10)
      : "unknown";
    stats.byDay[day] = (stats.byDay[day] || 0) + 1;

    // Counters
    if (e.type === "correction") stats.corrections++;
    if (e.type === "error") stats.errors++;
    if (e.type === "commit") stats.commits++;
    if (e.type === "prompt") stats.prompts++;
    if (e.type === "tool_call") stats.toolCalls++;
  }

  return stats;
}

function buildMarkdownReport(
  events: any[],
  stats: EventStats,
  opts: { title: string; period: string; scope: string }
): string {
  const lines: string[] = [];

  // Header
  lines.push(`# ${opts.title}`);
  lines.push("");
  lines.push(`**Period:** ${opts.period}`);
  lines.push(`**Scope:** ${opts.scope}`);
  lines.push(`**Generated:** ${new Date().toISOString().slice(0, 16)}`);
  lines.push("");

  // Summary
  lines.push("## Summary");
  lines.push("");
  lines.push(`| Metric | Count |`);
  lines.push(`|--------|-------|`);
  lines.push(`| Total events | ${stats.total} |`);
  lines.push(`| Prompts | ${stats.prompts} |`);
  lines.push(`| Tool calls | ${stats.toolCalls} |`);
  lines.push(`| Commits | ${stats.commits} |`);
  lines.push(`| Corrections | ${stats.corrections} |`);
  lines.push(`| Errors | ${stats.errors} |`);
  lines.push("");

  // Correction rate (prompt quality indicator)
  if (stats.prompts > 0) {
    const correctionRate = ((stats.corrections / stats.prompts) * 100).toFixed(
      1
    );
    lines.push("## Prompt Quality");
    lines.push("");
    lines.push(
      `- **Correction rate:** ${correctionRate}% (${stats.corrections} corrections / ${stats.prompts} prompts)`
    );
    const quality =
      stats.corrections / stats.prompts < 0.1
        ? "🟢 Excellent"
        : stats.corrections / stats.prompts < 0.25
          ? "🟡 Good"
          : "🔴 Needs improvement";
    lines.push(`- **Assessment:** ${quality}`);
    lines.push("");
  }

  // Activity by day
  const sortedDays = Object.keys(stats.byDay).sort();
  if (sortedDays.length > 0) {
    lines.push("## Daily Activity");
    lines.push("");
    lines.push("| Date | Events |");
    lines.push("|------|--------|");
    for (const day of sortedDays) {
      const bar = "█".repeat(Math.min(Math.ceil(stats.byDay[day] / 5), 20));
      lines.push(`| ${day} | ${stats.byDay[day]} ${bar} |`);
    }
    lines.push("");
  }

  // Event type breakdown
  lines.push("## Event Breakdown");
  lines.push("");
  const typeIcons: Record<string, string> = {
    prompt: "💬",
    assistant: "🤖",
    tool_call: "🔧",
    correction: "❌",
    commit: "📦",
    compaction: "🗜️",
    sub_agent_spawn: "🚀",
    error: "⚠️",
  };
  for (const [type, count] of Object.entries(stats.byType).sort(
    (a, b) => b[1] - a[1]
  )) {
    const icon = typeIcons[type] || "❓";
    lines.push(`- ${icon} **${type}**: ${count}`);
  }
  lines.push("");

  // Recent commits
  const commits = events
    .filter((e: any) => e.type === "commit")
    .slice(-10);
  if (commits.length > 0) {
    lines.push("## Recent Commits");
    lines.push("");
    for (const c of commits) {
      const hash = c.commit_hash ? c.commit_hash.slice(0, 7) : "???????";
      const msg = (c.content || c.summary || "").slice(0, 100).replace(/\n/g, " ");
      const time = c.timestamp
        ? new Date(c.timestamp).toISOString().slice(0, 16)
        : "";
      lines.push(`- \`${hash}\` ${msg} _(${time})_`);
    }
    lines.push("");
  }

  // Recent errors
  const errors = events
    .filter((e: any) => e.type === "error")
    .slice(-5);
  if (errors.length > 0) {
    lines.push("## Recent Errors");
    lines.push("");
    for (const e of errors) {
      const msg = (e.content || e.summary || "").slice(0, 150).replace(/\n/g, " ");
      const time = e.timestamp
        ? new Date(e.timestamp).toISOString().slice(0, 16)
        : "";
      lines.push(`- ⚠️ ${msg} _(${time})_`);
    }
    lines.push("");
  }

  lines.push("---");
  lines.push("_Generated by preflight `export_report`_");

  return lines.join("\n");
}

// ── Registration ───────────────────────────────────────────────────────────

export function registerExportReport(server: McpServer) {
  server.tool(
    "export_report",
    "Generate a markdown session report from timeline data. Includes activity summary, prompt quality trends, daily breakdown, and recent commits/errors.",
    {
      scope: z
        .enum(["current", "related", "all"])
        .default("current")
        .describe("Search scope"),
      project: z.string().optional().describe("Filter to a specific project"),
      period: z
        .enum(["day", "week", "month", "custom"])
        .default("week")
        .describe("Report period"),
      since: z
        .string()
        .optional()
        .describe(
          "Start date (ISO or relative like '7days'). Overrides period."
        ),
      until: z.string().optional().describe("End date (ISO or relative)"),
      title: z
        .string()
        .optional()
        .describe("Custom report title"),
      save_to: z
        .string()
        .optional()
        .describe(
          "File path to save the report (markdown). If omitted, returns inline."
        ),
    },
    async (params) => {
      // Determine date range
      let since: string | undefined;
      let until: string | undefined;

      if (params.since) {
        since = parseRelativeDate(params.since);
      } else {
        const d = new Date();
        switch (params.period) {
          case "day":
            d.setDate(d.getDate() - 1);
            break;
          case "week":
            d.setDate(d.getDate() - 7);
            break;
          case "month":
            d.setMonth(d.getMonth() - 1);
            break;
        }
        since = d.toISOString();
      }

      if (params.until) {
        until = parseRelativeDate(params.until);
      }

      // Get projects
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

      // Fetch all events (use large limit for reports)
      const events = await getTimeline({
        project_dirs: projectDirs,
        project: undefined,
        since,
        until,
        limit: 2000,
        offset: 0,
      });

      const stats = computeStats(events);

      const periodLabel = params.since
        ? `${since?.slice(0, 10)} → ${until?.slice(0, 10) || "now"}`
        : `Last ${params.period}`;

      const title =
        params.title ||
        `Preflight Session Report — ${periodLabel}`;

      const report = buildMarkdownReport(events, stats, {
        title,
        period: periodLabel,
        scope: params.project || params.scope,
      });

      // Optionally save to file
      if (params.save_to) {
        const dir = params.save_to.substring(
          0,
          params.save_to.lastIndexOf("/")
        );
        if (dir) {
          await mkdir(dir, { recursive: true });
        }
        await writeFile(params.save_to, report, "utf-8");
        return {
          content: [
            {
              type: "text" as const,
              text: `Report saved to \`${params.save_to}\`\n\n${report}`,
            },
          ],
        };
      }

      return {
        content: [{ type: "text" as const, text: report }],
      };
    }
  );
}
