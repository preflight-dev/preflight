// =============================================================================
// export_report — Generate markdown session reports from timeline data
// Closes #5: Export timeline to markdown reports
// =============================================================================

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getTimeline, listIndexedProjects } from "../lib/timeline-db.js";
import { getRelatedProjects } from "../lib/config.js";
import { writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import type { SearchScope } from "../types.js";

// ── Helpers ────────────────────────────────────────────────────────────────

function relativeDate(offset: number, unit: "day" | "week"): string {
  const d = new Date();
  d.setDate(d.getDate() - offset * (unit === "week" ? 7 : 1));
  return d.toISOString();
}

function fmtDate(iso: string): string {
  return new Date(iso).toISOString().slice(0, 10);
}

function fmtTime(iso: string): string {
  return new Date(iso).toISOString().slice(11, 16);
}

async function getSearchProjects(scope: SearchScope): Promise<string[]> {
  const current = process.env.CLAUDE_PROJECT_DIR;
  switch (scope) {
    case "current":
      return current ? [current] : [];
    case "related": {
      const related = getRelatedProjects();
      return current ? [current, ...related] : related;
    }
    case "all": {
      const projects = await listIndexedProjects();
      return projects.map((p) => p.project);
    }
    default:
      return current ? [current] : [];
  }
}

// ── Report Generation ──────────────────────────────────────────────────────

interface ReportStats {
  totalEvents: number;
  prompts: number;
  corrections: number;
  commits: number;
  toolCalls: number;
  errors: number;
  compactions: number;
  subAgentSpawns: number;
  activeDays: number;
  correctionRate: string;
  topTools: [string, number][];
}

function computeStats(events: any[]): ReportStats {
  const counts: Record<string, number> = {};
  const days = new Set<string>();
  const toolNames = new Map<string, number>();

  for (const e of events) {
    counts[e.type] = (counts[e.type] || 0) + 1;
    if (e.timestamp) days.add(fmtDate(e.timestamp));
    if (e.type === "tool_call" && e.tool_name) {
      toolNames.set(e.tool_name, (toolNames.get(e.tool_name) || 0) + 1);
    }
  }

  const prompts = counts["prompt"] || 0;
  const corrections = counts["correction"] || 0;

  return {
    totalEvents: events.length,
    prompts,
    corrections,
    commits: counts["commit"] || 0,
    toolCalls: counts["tool_call"] || 0,
    errors: counts["error"] || 0,
    compactions: counts["compaction"] || 0,
    subAgentSpawns: counts["sub_agent_spawn"] || 0,
    activeDays: days.size,
    correctionRate: prompts > 0 ? ((corrections / prompts) * 100).toFixed(1) : "0",
    topTools: [...toolNames.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10),
  };
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

function generateMarkdown(
  events: any[],
  stats: ReportStats,
  opts: { title: string; since: string; until: string; scope: string }
): string {
  const lines: string[] = [];

  // Header
  lines.push(`# ${opts.title}`);
  lines.push("");
  lines.push(`**Period:** ${fmtDate(opts.since)} → ${fmtDate(opts.until)}`);
  lines.push(`**Scope:** ${opts.scope}`);
  lines.push(`**Generated:** ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC`);
  lines.push("");

  // Summary stats
  lines.push("## Summary");
  lines.push("");
  lines.push(`| Metric | Value |`);
  lines.push(`|--------|-------|`);
  lines.push(`| Active days | ${stats.activeDays} |`);
  lines.push(`| Total prompts | ${stats.prompts} |`);
  lines.push(`| Corrections | ${stats.corrections} (${stats.correctionRate}%) |`);
  lines.push(`| Commits | ${stats.commits} |`);
  lines.push(`| Tool calls | ${stats.toolCalls} |`);
  lines.push(`| Errors | ${stats.errors} |`);
  lines.push(`| Compactions | ${stats.compactions} |`);
  lines.push(`| Sub-agent spawns | ${stats.subAgentSpawns} |`);
  lines.push("");

  // Tool usage breakdown
  if (stats.topTools.length > 0) {
    lines.push("## Tool Usage");
    lines.push("");
    lines.push("| Tool | Calls |");
    lines.push("|------|-------|");
    for (const [name, count] of stats.topTools) {
      lines.push(`| ${name} | ${count} |`);
    }
    lines.push("");
  }

  // Daily breakdown
  const days = new Map<string, any[]>();
  for (const e of events) {
    const day = e.timestamp ? fmtDate(e.timestamp) : "unknown";
    if (!days.has(day)) days.set(day, []);
    days.get(day)!.push(e);
  }

  lines.push("## Daily Activity");
  lines.push("");

  const sortedDays = [...days.keys()].sort().reverse();
  for (const day of sortedDays) {
    const dayEvents = days.get(day)!;
    const dayCounts: Record<string, number> = {};
    for (const e of dayEvents) {
      dayCounts[e.type] = (dayCounts[e.type] || 0) + 1;
    }

    const badges = Object.entries(dayCounts)
      .map(([type, count]) => `${TYPE_ICONS[type] || "❓"} ${count}`)
      .join(" · ");

    lines.push(`### ${day} (${badges})`);
    lines.push("");

    // Show commits for the day
    const commits = dayEvents.filter((e: any) => e.type === "commit");
    if (commits.length > 0) {
      lines.push("**Commits:**");
      for (const c of commits) {
        const hash = c.commit_hash ? c.commit_hash.slice(0, 7) : "???????";
        const msg = (c.content || c.summary || "").slice(0, 100).replace(/\n/g, " ");
        lines.push(`- \`${hash}\` ${msg}`);
      }
      lines.push("");
    }

    // Show errors for the day
    const errors = dayEvents.filter((e: any) => e.type === "error");
    if (errors.length > 0) {
      lines.push("**Errors:**");
      for (const e of errors) {
        const msg = (e.content || "").slice(0, 120).replace(/\n/g, " ");
        lines.push(`- ⚠️ ${msg}`);
      }
      lines.push("");
    }

    // Show corrections
    const corrections = dayEvents.filter((e: any) => e.type === "correction");
    if (corrections.length > 0) {
      lines.push("**Corrections:**");
      for (const c of corrections) {
        const msg = (c.content || "").slice(0, 120).replace(/\n/g, " ");
        lines.push(`- ❌ ${msg}`);
      }
      lines.push("");
    }
  }

  // Prompt quality trend (daily correction rates)
  if (sortedDays.length > 1) {
    lines.push("## Prompt Quality Trend");
    lines.push("");
    lines.push("| Date | Prompts | Corrections | Rate |");
    lines.push("|------|---------|-------------|------|");
    for (const day of [...sortedDays].reverse()) {
      const dayEvents = days.get(day)!;
      const p = dayEvents.filter((e: any) => e.type === "prompt").length;
      const c = dayEvents.filter((e: any) => e.type === "correction").length;
      const rate = p > 0 ? ((c / p) * 100).toFixed(1) + "%" : "—";
      lines.push(`| ${day} | ${p} | ${c} | ${rate} |`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

// ── Tool Registration ──────────────────────────────────────────────────────

export function registerExportReport(server: McpServer): void {
  server.tool(
    "export_report",
    "Generate a markdown session report from timeline data. Includes summary stats, daily activity breakdown, prompt quality trends, and tool usage. Optionally saves to file.",
    {
      scope: z
        .enum(["current", "related", "all"])
        .default("current")
        .describe("Search scope: current project, related, or all indexed"),
      period: z
        .enum(["day", "week", "month", "quarter"])
        .default("week")
        .describe("Report period"),
      since: z
        .string()
        .optional()
        .describe("Custom start date (ISO or relative like '7days'). Overrides period."),
      until: z
        .string()
        .optional()
        .describe("Custom end date (ISO). Defaults to now."),
      title: z
        .string()
        .optional()
        .describe("Custom report title"),
      saveTo: z
        .string()
        .optional()
        .describe("File path to save the report. If omitted, returns inline."),
    },
    async (params) => {
      // Determine date range
      const now = new Date().toISOString();
      let since: string;
      let until = params.until || now;

      if (params.since) {
        // Parse relative dates
        const relMatch = params.since.match(/^(\d+)(days?|weeks?|months?)$/);
        if (relMatch) {
          const [, numStr, unit] = relMatch;
          const num = parseInt(numStr, 10);
          const d = new Date();
          if (unit.startsWith("day")) d.setDate(d.getDate() - num);
          else if (unit.startsWith("week")) d.setDate(d.getDate() - num * 7);
          else if (unit.startsWith("month")) d.setMonth(d.getMonth() - num);
          since = d.toISOString();
        } else {
          since = params.since;
        }
      } else {
        const periodDays = { day: 1, week: 7, month: 30, quarter: 90 };
        since = relativeDate(periodDays[params.period], "day");
      }

      // Get projects
      const projectDirs = await getSearchProjects(params.scope);
      if (projectDirs.length === 0) {
        return {
          content: [
            {
              type: "text" as const,
              text: `No projects found for scope "${params.scope}". Set CLAUDE_PROJECT_DIR or onboard projects first.`,
            },
          ],
        };
      }

      // Fetch events
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
              text: `No events found for ${fmtDate(since)} → ${fmtDate(until)}.`,
            },
          ],
        };
      }

      // Generate report
      const stats = computeStats(events);
      const periodLabel = params.period.charAt(0).toUpperCase() + params.period.slice(1);
      const title = params.title || `${periodLabel}ly Session Report`;
      const markdown = generateMarkdown(events, stats, {
        title,
        since,
        until,
        scope: params.scope,
      });

      // Save if requested
      if (params.saveTo) {
        try {
          const dir = params.saveTo.substring(0, params.saveTo.lastIndexOf("/"));
          if (dir) mkdirSync(dir, { recursive: true });
          writeFileSync(params.saveTo, markdown, "utf-8");
          return {
            content: [
              {
                type: "text" as const,
                text: `✅ Report saved to ${params.saveTo}\n\n${markdown}`,
              },
            ],
          };
        } catch (err: any) {
          return {
            content: [
              {
                type: "text" as const,
                text: `❌ Failed to save report: ${err.message}\n\n${markdown}`,
              },
            ],
          };
        }
      }

      return {
        content: [{ type: "text" as const, text: markdown }],
      };
    }
  );
}
