// =============================================================================
// export_report — Generate markdown reports from timeline data
// Addresses: https://github.com/TerminalGravity/preflight/issues/5
// =============================================================================

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getTimeline, listIndexedProjects } from "../lib/timeline-db.js";
import { getRelatedProjects } from "../lib/config.js";
import { writeFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import type { SearchScope } from "../types.js";

// ── Helpers ────────────────────────────────────────────────────────────────

function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
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

interface EventSummary {
  total: number;
  byType: Record<string, number>;
  byDay: Map<string, Record<string, number>>;
  corrections: number;
  avgPromptsPerDay: number;
  activeDays: number;
}

function summarizeEvents(events: any[]): EventSummary {
  const byType: Record<string, number> = {};
  const byDay = new Map<string, Record<string, number>>();

  for (const e of events) {
    byType[e.type] = (byType[e.type] || 0) + 1;
    const day = e.timestamp
      ? new Date(e.timestamp).toISOString().slice(0, 10)
      : "unknown";
    if (!byDay.has(day)) byDay.set(day, {});
    const dayMap = byDay.get(day)!;
    dayMap[e.type] = (dayMap[e.type] || 0) + 1;
  }

  const activeDays = byDay.size;
  const prompts = byType["prompt"] || 0;

  return {
    total: events.length,
    byType,
    byDay,
    corrections: byType["correction"] || 0,
    avgPromptsPerDay: activeDays > 0 ? Math.round(prompts / activeDays) : 0,
    activeDays,
  };
}

const TYPE_LABELS: Record<string, string> = {
  prompt: "💬 Prompts",
  assistant: "🤖 Responses",
  tool_call: "🔧 Tool Calls",
  correction: "❌ Corrections",
  commit: "📦 Commits",
  compaction: "🗜️ Compactions",
  sub_agent_spawn: "🚀 Sub-agents",
  error: "⚠️ Errors",
};

function buildMarkdownReport(
  title: string,
  period: string,
  projectName: string,
  events: any[],
  summary: EventSummary
): string {
  const lines: string[] = [];
  const now = new Date().toISOString().slice(0, 19).replace("T", " ");

  lines.push(`# ${title}`);
  lines.push("");
  lines.push(`**Project:** ${projectName}`);
  lines.push(`**Period:** ${period}`);
  lines.push(`**Generated:** ${now}`);
  lines.push("");

  // Overview
  lines.push("## Overview");
  lines.push("");
  lines.push(`| Metric | Value |`);
  lines.push(`| --- | --- |`);
  lines.push(`| Total Events | ${summary.total} |`);
  lines.push(`| Active Days | ${summary.activeDays} |`);
  lines.push(`| Avg Prompts/Day | ${summary.avgPromptsPerDay} |`);
  lines.push(`| Corrections | ${summary.corrections} |`);

  const correctionRate =
    (summary.byType["prompt"] || 0) > 0
      ? ((summary.corrections / summary.byType["prompt"]) * 100).toFixed(1)
      : "0";
  lines.push(`| Correction Rate | ${correctionRate}% |`);
  lines.push("");

  // Activity breakdown
  lines.push("## Activity Breakdown");
  lines.push("");
  for (const [type, count] of Object.entries(summary.byType).sort(
    (a, b) => b[1] - a[1]
  )) {
    const label = TYPE_LABELS[type] || type;
    const bar = "█".repeat(Math.min(Math.ceil(count / 5), 30));
    lines.push(`- ${label}: **${count}** ${bar}`);
  }
  lines.push("");

  // Daily activity
  lines.push("## Daily Activity");
  lines.push("");
  const sortedDays = [...summary.byDay.keys()].sort().reverse();
  lines.push(`| Date | Prompts | Tools | Commits | Corrections | Total |`);
  lines.push(`| --- | --- | --- | --- | --- | --- |`);
  for (const day of sortedDays) {
    const d = summary.byDay.get(day)!;
    const total = Object.values(d).reduce((a, b) => a + b, 0);
    lines.push(
      `| ${day} | ${d["prompt"] || 0} | ${d["tool_call"] || 0} | ${d["commit"] || 0} | ${d["correction"] || 0} | ${total} |`
    );
  }
  lines.push("");

  // Recent commits
  const commits = events
    .filter((e) => e.type === "commit")
    .sort(
      (a, b) =>
        new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    )
    .slice(0, 20);

  if (commits.length > 0) {
    lines.push("## Recent Commits");
    lines.push("");
    for (const c of commits) {
      const date = new Date(c.timestamp).toISOString().slice(0, 10);
      const hash = c.commit_hash ? c.commit_hash.slice(0, 7) : "???????";
      const msg = (c.content || c.summary || "").slice(0, 100).replace(/\n/g, " ");
      lines.push(`- \`${hash}\` ${date} — ${msg}`);
    }
    lines.push("");
  }

  // Prompt quality trends (corrections vs prompts by day)
  if (summary.corrections > 0) {
    lines.push("## Prompt Quality Trends");
    lines.push("");
    lines.push(
      "_Days with corrections (higher correction rate = more iteration needed):_"
    );
    lines.push("");
    for (const day of sortedDays) {
      const d = summary.byDay.get(day)!;
      const dayPrompts = d["prompt"] || 0;
      const dayCorrections = d["correction"] || 0;
      if (dayCorrections > 0 && dayPrompts > 0) {
        const rate = ((dayCorrections / dayPrompts) * 100).toFixed(0);
        lines.push(
          `- **${day}**: ${dayCorrections}/${dayPrompts} corrections (${rate}%)`
        );
      }
    }
    lines.push("");
  }

  lines.push("---");
  lines.push("_Generated by preflight `export_report` tool_");

  return lines.join("\n");
}

// ── Registration ───────────────────────────────────────────────────────────

export function registerExportReport(server: McpServer) {
  server.tool(
    "export_report",
    "Generate a markdown session report from timeline data. Summarizes activity, prompt quality trends, commits, and daily stats for a given period.",
    {
      scope: z
        .enum(["current", "related", "all"])
        .default("current")
        .describe("Search scope"),
      project: z
        .string()
        .optional()
        .describe("Specific project directory (overrides scope)"),
      period: z
        .enum(["day", "week", "month", "custom"])
        .default("week")
        .describe("Report period"),
      since: z
        .string()
        .optional()
        .describe("Custom start date (ISO 8601). Used when period=custom."),
      until: z
        .string()
        .optional()
        .describe("Custom end date (ISO 8601). Used when period=custom."),
      output: z
        .string()
        .optional()
        .describe(
          "File path to write the report. If omitted, returns inline."
        ),
    },
    async (params) => {
      // Determine date range
      let since: string;
      let until: string = new Date().toISOString();
      let periodLabel: string;

      switch (params.period) {
        case "day":
          since = daysAgo(1);
          periodLabel = "Last 24 hours";
          break;
        case "week":
          since = daysAgo(7);
          periodLabel = "Last 7 days";
          break;
        case "month":
          since = daysAgo(30);
          periodLabel = "Last 30 days";
          break;
        case "custom":
          if (!params.since) {
            return {
              content: [
                {
                  type: "text",
                  text: "Error: `since` is required when period=custom.",
                },
              ],
            };
          }
          since = params.since;
          until = params.until || until;
          periodLabel = `${since.slice(0, 10)} to ${until.slice(0, 10)}`;
          break;
        default:
          since = daysAgo(7);
          periodLabel = "Last 7 days";
      }

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
              type: "text",
              text: `No projects found for scope "${params.scope}". Set CLAUDE_PROJECT_DIR or onboard a project first.`,
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
              type: "text",
              text: `No events found for the ${periodLabel} period.`,
            },
          ],
        };
      }

      const summary = summarizeEvents(events);
      const projectName =
        params.project || projectDirs.join(", ") || "All Projects";

      const title =
        params.period === "week"
          ? "Weekly Session Report"
          : params.period === "month"
            ? "Monthly Session Report"
            : params.period === "day"
              ? "Daily Session Report"
              : "Session Report";

      const report = buildMarkdownReport(
        title,
        periodLabel,
        projectName,
        events,
        summary
      );

      // Write to file if requested
      if (params.output) {
        try {
          mkdirSync(dirname(params.output), { recursive: true });
          writeFileSync(params.output, report, "utf-8");
          return {
            content: [
              {
                type: "text",
                text: `Report written to \`${params.output}\` (${report.length} bytes, ${summary.total} events).`,
              },
            ],
          };
        } catch (err: any) {
          return {
            content: [
              {
                type: "text",
                text: `Failed to write report: ${err.message}\n\n${report}`,
              },
            ],
          };
        }
      }

      return { content: [{ type: "text", text: report }] };
    }
  );
}
