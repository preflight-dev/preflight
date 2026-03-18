// =============================================================================
// export_report — Generate markdown session reports from timeline data
// Weekly summaries, prompt quality trends, activity breakdowns
// =============================================================================

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getTimeline, listIndexedProjects } from "../lib/timeline-db.js";
import { getRelatedProjects } from "../lib/config.js";
import type { SearchScope } from "../types.js";
import { writeFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";

// ── Helpers ────────────────────────────────────────────────────────────────

function getDateRange(period: string): { since: string; until: string; label: string } {
  const now = new Date();
  const until = now.toISOString();

  switch (period) {
    case "today": {
      const start = new Date(now);
      start.setHours(0, 0, 0, 0);
      return { since: start.toISOString(), until, label: now.toISOString().slice(0, 10) };
    }
    case "yesterday": {
      const end = new Date(now);
      end.setHours(0, 0, 0, 0);
      const start = new Date(end);
      start.setDate(start.getDate() - 1);
      return { since: start.toISOString(), until: end.toISOString(), label: start.toISOString().slice(0, 10) };
    }
    case "week": {
      const start = new Date(now);
      start.setDate(start.getDate() - 7);
      return {
        since: start.toISOString(),
        until,
        label: `${start.toISOString().slice(0, 10)} to ${now.toISOString().slice(0, 10)}`,
      };
    }
    case "month": {
      const start = new Date(now);
      start.setMonth(start.getMonth() - 1);
      return {
        since: start.toISOString(),
        until,
        label: `${start.toISOString().slice(0, 10)} to ${now.toISOString().slice(0, 10)}`,
      };
    }
    default:
      throw new Error(`Unknown period: ${period}`);
  }
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
  byDay: Record<string, number>;
  corrections: number;
  errors: number;
  commits: number;
  prompts: number;
  toolCalls: number;
}

function summarizeEvents(events: any[]): EventSummary {
  const summary: EventSummary = {
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
    summary.byType[e.type] = (summary.byType[e.type] || 0) + 1;

    // By day
    const day = e.timestamp ? new Date(e.timestamp).toISOString().slice(0, 10) : "unknown";
    summary.byDay[day] = (summary.byDay[day] || 0) + 1;

    // Counts
    if (e.type === "correction") summary.corrections++;
    if (e.type === "error") summary.errors++;
    if (e.type === "commit") summary.commits++;
    if (e.type === "prompt") summary.prompts++;
    if (e.type === "tool_call") summary.toolCalls++;
  }

  return summary;
}

function generateMarkdown(
  summary: EventSummary,
  label: string,
  projectName: string,
  events: any[],
): string {
  const lines: string[] = [];

  lines.push(`# Session Report: ${projectName}`);
  lines.push(`**Period:** ${label}`);
  lines.push(`**Generated:** ${new Date().toISOString().slice(0, 19).replace("T", " ")} UTC`);
  lines.push("");

  // Overview
  lines.push("## Overview");
  lines.push("");
  lines.push(`| Metric | Count |`);
  lines.push(`|--------|-------|`);
  lines.push(`| Total Events | ${summary.total} |`);
  lines.push(`| Prompts | ${summary.prompts} |`);
  lines.push(`| Tool Calls | ${summary.toolCalls} |`);
  lines.push(`| Commits | ${summary.commits} |`);
  lines.push(`| Corrections | ${summary.corrections} |`);
  lines.push(`| Errors | ${summary.errors} |`);
  lines.push("");

  // Correction rate (prompt quality indicator)
  if (summary.prompts > 0) {
    const correctionRate = ((summary.corrections / summary.prompts) * 100).toFixed(1);
    lines.push("## Prompt Quality");
    lines.push("");
    lines.push(`- **Correction rate:** ${correctionRate}% (${summary.corrections} corrections / ${summary.prompts} prompts)`);
    const quality =
      parseFloat(correctionRate) < 5 ? "🟢 Excellent" :
      parseFloat(correctionRate) < 15 ? "🟡 Good" :
      parseFloat(correctionRate) < 30 ? "🟠 Needs Improvement" :
      "🔴 Poor";
    lines.push(`- **Quality:** ${quality}`);
    lines.push("");
  }

  // Daily activity
  const sortedDays = Object.keys(summary.byDay).sort();
  if (sortedDays.length > 1) {
    lines.push("## Daily Activity");
    lines.push("");
    lines.push("| Date | Events |");
    lines.push("|------|--------|");
    for (const day of sortedDays) {
      const count = summary.byDay[day];
      const bar = "█".repeat(Math.min(Math.ceil(count / 5), 20));
      lines.push(`| ${day} | ${count} ${bar} |`);
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
  for (const [type, count] of Object.entries(summary.byType).sort((a, b) => b[1] - a[1])) {
    const icon = typeIcons[type] || "❓";
    const pct = ((count / summary.total) * 100).toFixed(1);
    lines.push(`- ${icon} **${type}**: ${count} (${pct}%)`);
  }
  lines.push("");

  // Recent commits
  const recentCommits = events
    .filter((e) => e.type === "commit")
    .slice(-10);
  if (recentCommits.length > 0) {
    lines.push("## Recent Commits");
    lines.push("");
    for (const c of recentCommits) {
      const hash = c.commit_hash ? c.commit_hash.slice(0, 7) : "???????";
      const msg = (c.content || c.summary || "").slice(0, 80).replace(/\n/g, " ");
      const time = c.timestamp ? new Date(c.timestamp).toISOString().slice(0, 16).replace("T", " ") : "";
      lines.push(`- \`${hash}\` ${msg} _(${time})_`);
    }
    lines.push("");
  }

  // Recent errors
  const recentErrors = events.filter((e) => e.type === "error").slice(-5);
  if (recentErrors.length > 0) {
    lines.push("## Recent Errors");
    lines.push("");
    for (const e of recentErrors) {
      const msg = (e.content || "").slice(0, 120).replace(/\n/g, " ");
      const time = e.timestamp ? new Date(e.timestamp).toISOString().slice(0, 16).replace("T", " ") : "";
      lines.push(`- ⚠️ ${msg} _(${time})_`);
    }
    lines.push("");
  }

  lines.push("---");
  lines.push("_Generated by [preflight](https://github.com/TerminalGravity/preflight) `export_report` tool_");

  return lines.join("\n");
}

// ── Tool Registration ──────────────────────────────────────────────────────

export function registerExportReport(server: McpServer) {
  server.tool(
    "export_report",
    "Generate a markdown session report from timeline data. Shows activity summaries, prompt quality trends, daily breakdowns, and recent commits/errors.",
    {
      scope: z
        .enum(["current", "related", "all"])
        .default("current")
        .describe("Search scope: current project, related projects, or all indexed"),
      project: z.string().optional().describe("Filter to a specific project (overrides scope)"),
      period: z
        .enum(["today", "yesterday", "week", "month"])
        .default("week")
        .describe("Time period for the report"),
      output: z
        .string()
        .optional()
        .describe("File path to write the report to. If omitted, returns inline."),
    },
    async (params) => {
      const { since, until, label } = getDateRange(params.period);

      // Determine projects
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

      // Fetch all events in range (high limit for reports)
      const events = await getTimeline({
        project_dirs: projectDirs,
        project: undefined,
        since,
        until,
        limit: 5000,
        offset: 0,
      });

      const projectName = params.project || (projectDirs.length === 1 ? projectDirs[0] : `${projectDirs.length} projects`);
      const summary = summarizeEvents(events);
      const markdown = generateMarkdown(summary, label, projectName, events);

      // Write to file if requested
      if (params.output) {
        try {
          mkdirSync(dirname(params.output), { recursive: true });
          writeFileSync(params.output, markdown, "utf-8");
          return {
            content: [
              {
                type: "text" as const,
                text: `Report written to ${params.output} (${summary.total} events, ${label})`,
              },
            ],
          };
        } catch (err: any) {
          return {
            content: [
              {
                type: "text" as const,
                text: `Failed to write report: ${err.message}\n\n${markdown}`,
              },
            ],
          };
        }
      }

      return { content: [{ type: "text" as const, text: markdown }] };
    },
  );
}
