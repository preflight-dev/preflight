// =============================================================================
// export_report — Export timeline data to structured markdown reports
// Addresses: https://github.com/TerminalGravity/preflight/issues/5
// =============================================================================

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getTimeline, listIndexedProjects } from "../lib/timeline-db.js";
import { getRelatedProjects } from "../lib/config.js";
import { writeFileSync, mkdirSync } from "fs";
import { dirname } from "path";
import type { SearchScope } from "../types.js";

// ── Types ──────────────────────────────────────────────────────────────────

interface DaySummary {
  date: string;
  events: any[];
  prompts: number;
  responses: number;
  toolCalls: number;
  corrections: number;
  commits: number;
  errors: number;
  compactions: number;
  subAgentSpawns: number;
}

interface ReportData {
  project: string;
  period: { since: string; until: string };
  days: DaySummary[];
  totals: {
    events: number;
    prompts: number;
    responses: number;
    toolCalls: number;
    corrections: number;
    commits: number;
    errors: number;
    compactions: number;
    subAgentSpawns: number;
    activeDays: number;
  };
}

// ── Helpers ────────────────────────────────────────────────────────────────

const RELATIVE_DATE_RE = /^(\d+)(days?|weeks?|months?)$/;

function parseRelativeDate(input: string): string {
  const match = input.match(RELATIVE_DATE_RE);
  if (!match) return input;
  const [, numStr, unit] = match;
  const num = parseInt(numStr, 10);
  const d = new Date();
  if (unit.startsWith("day")) d.setDate(d.getDate() - num);
  else if (unit.startsWith("week")) d.setDate(d.getDate() - num * 7);
  else if (unit.startsWith("month")) d.setMonth(d.getMonth() - num);
  return d.toISOString();
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

// ── Data Collection ────────────────────────────────────────────────────────

async function collectReportData(opts: {
  scope: SearchScope;
  project?: string;
  since?: string;
  until?: string;
}): Promise<ReportData> {
  const sinceISO = opts.since ? parseRelativeDate(opts.since) : undefined;
  const untilISO = opts.until ? parseRelativeDate(opts.until) : undefined;

  let projectDirs: string[];
  if (opts.project) {
    projectDirs = [opts.project];
  } else {
    projectDirs = await getSearchProjects(opts.scope);
  }

  const events = await getTimeline({
    project_dirs: projectDirs,
    since: sinceISO,
    until: untilISO,
    limit: 5000,
    offset: 0,
  });

  // Group by day
  const dayMap = new Map<string, any[]>();
  for (const ev of events) {
    const day = ev.timestamp
      ? new Date(ev.timestamp).toISOString().slice(0, 10)
      : "unknown";
    if (!dayMap.has(day)) dayMap.set(day, []);
    dayMap.get(day)!.push(ev);
  }

  const days: DaySummary[] = [];
  for (const [date, dayEvents] of [...dayMap.entries()].sort()) {
    const count = (type: string) => dayEvents.filter((e: any) => e.type === type).length;
    days.push({
      date,
      events: dayEvents,
      prompts: count("prompt"),
      responses: count("assistant"),
      toolCalls: count("tool_call"),
      corrections: count("correction"),
      commits: count("commit"),
      errors: count("error"),
      compactions: count("compaction"),
      subAgentSpawns: count("sub_agent_spawn"),
    });
  }

  const totals = {
    events: events.length,
    prompts: days.reduce((s, d) => s + d.prompts, 0),
    responses: days.reduce((s, d) => s + d.responses, 0),
    toolCalls: days.reduce((s, d) => s + d.toolCalls, 0),
    corrections: days.reduce((s, d) => s + d.corrections, 0),
    commits: days.reduce((s, d) => s + d.commits, 0),
    errors: days.reduce((s, d) => s + d.errors, 0),
    compactions: days.reduce((s, d) => s + d.compactions, 0),
    subAgentSpawns: days.reduce((s, d) => s + d.subAgentSpawns, 0),
    activeDays: days.length,
  };

  const projectName =
    opts.project ||
    events[0]?.project_name ||
    events[0]?.project ||
    "unknown";

  return {
    project: projectName,
    period: {
      since: sinceISO || (days[0]?.date ?? "unknown"),
      until: untilISO || (days[days.length - 1]?.date ?? "unknown"),
    },
    days,
    totals,
  };
}

// ── Report Formatters ──────────────────────────────────────────────────────

function formatWeeklySummary(data: ReportData): string {
  const lines: string[] = [];
  const { totals, days, project, period } = data;

  lines.push(`# 📋 Weekly Summary Report`);
  lines.push(`**Project:** ${project}`);
  lines.push(
    `**Period:** ${period.since.slice(0, 10)} → ${period.until.slice(0, 10)} (${totals.activeDays} active days)`,
  );
  lines.push(`**Generated:** ${new Date().toISOString().slice(0, 10)}`);
  lines.push("");

  // Overview stats
  lines.push(`## Overview`);
  lines.push("");
  lines.push(`| Metric | Count |`);
  lines.push(`|--------|-------|`);
  lines.push(`| Total events | ${totals.events} |`);
  lines.push(`| Prompts | ${totals.prompts} |`);
  lines.push(`| Tool calls | ${totals.toolCalls} |`);
  lines.push(`| Commits | ${totals.commits} |`);
  lines.push(`| Corrections | ${totals.corrections} |`);
  lines.push(`| Errors | ${totals.errors} |`);
  lines.push(`| Compactions | ${totals.compactions} |`);
  lines.push(`| Sub-agent spawns | ${totals.subAgentSpawns} |`);
  lines.push("");

  // Correction rate
  const correctionRate =
    totals.prompts > 0
      ? ((totals.corrections / totals.prompts) * 100).toFixed(1)
      : "0.0";
  lines.push(
    `**Correction rate:** ${correctionRate}% (${totals.corrections} corrections / ${totals.prompts} prompts)`,
  );
  lines.push("");

  // Daily breakdown
  lines.push(`## Daily Activity`);
  lines.push("");
  lines.push(`| Date | 💬 | 🔧 | 📦 | ❌ | ⚠️ |`);
  lines.push(`|------|-----|-----|-----|-----|-----|`);
  for (const day of days) {
    lines.push(
      `| ${day.date} | ${day.prompts} | ${day.toolCalls} | ${day.commits} | ${day.corrections} | ${day.errors} |`,
    );
  }
  lines.push("");

  // Busiest day
  const busiest = [...days].sort((a, b) => b.events.length - a.events.length)[0];
  if (busiest) {
    lines.push(
      `**Busiest day:** ${busiest.date} (${busiest.events.length} events, ${busiest.commits} commits)`,
    );
  }

  // Key commits
  const allCommits = days.flatMap((d) =>
    d.events.filter((e: any) => e.type === "commit"),
  );
  if (allCommits.length > 0) {
    lines.push("");
    lines.push(`## Key Commits`);
    lines.push("");
    for (const c of allCommits.slice(0, 20)) {
      const hash = c.commit_hash ? c.commit_hash.slice(0, 7) : "";
      const msg = (c.content || c.summary || "").slice(0, 120).replace(/\n/g, " ");
      const time = c.timestamp
        ? new Date(c.timestamp).toISOString().slice(0, 16).replace("T", " ")
        : "";
      lines.push(`- \`${hash}\` ${msg} _(${time})_`);
    }
  }

  // Errors
  const allErrors = days.flatMap((d) =>
    d.events.filter((e: any) => e.type === "error"),
  );
  if (allErrors.length > 0) {
    lines.push("");
    lines.push(`## Errors Encountered`);
    lines.push("");
    for (const e of allErrors.slice(0, 10)) {
      const msg = (e.content || "").slice(0, 200).replace(/\n/g, " ");
      lines.push(`- ⚠️ ${msg}`);
    }
  }

  return lines.join("\n");
}

function formatDetailedTimeline(data: ReportData): string {
  const lines: string[] = [];

  lines.push(`# 🕐 Detailed Timeline Report`);
  lines.push(`**Project:** ${data.project}`);
  lines.push(
    `**Period:** ${data.period.since.slice(0, 10)} → ${data.period.until.slice(0, 10)}`,
  );
  lines.push(`**Generated:** ${new Date().toISOString().slice(0, 10)}`);
  lines.push("");

  for (const day of data.days) {
    lines.push(`## ${day.date}`);
    lines.push(
      `_${day.events.length} events: ${day.prompts} prompts, ${day.toolCalls} tool calls, ${day.commits} commits_`,
    );
    lines.push("");

    // Sort events chronologically
    const sorted = [...day.events].sort((a: any, b: any) => {
      const ta = a.timestamp ? new Date(a.timestamp).getTime() : 0;
      const tb = b.timestamp ? new Date(b.timestamp).getTime() : 0;
      return ta - tb;
    });

    for (const ev of sorted) {
      const time = ev.timestamp
        ? new Date(ev.timestamp).toISOString().slice(11, 16)
        : "??:??";
      const icon = TYPE_ICONS[ev.type] || "❓";
      let content = (ev.content || ev.summary || "")
        .slice(0, 150)
        .replace(/\n/g, " ");

      if (ev.type === "commit") {
        const hash = ev.commit_hash ? ev.commit_hash.slice(0, 7) + ": " : "";
        content = `\`${hash}\`${content}`;
      } else if (ev.type === "tool_call") {
        const tool = ev.tool_name || "";
        content = tool ? `**${tool}** ${content}` : content;
      }

      lines.push(`- ${time} ${icon} ${content}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

function formatActivityDigest(data: ReportData): string {
  const lines: string[] = [];
  const { totals, days } = data;

  lines.push(`# 📊 Activity Digest`);
  lines.push(`**${data.project}** — ${data.period.since.slice(0, 10)} to ${data.period.until.slice(0, 10)}`);
  lines.push("");

  // Sparkline-style daily activity
  const maxEvents = Math.max(...days.map((d) => d.events.length), 1);
  lines.push(`## Daily Activity`);
  lines.push("");
  for (const day of days) {
    const bar = "█".repeat(Math.max(1, Math.round((day.events.length / maxEvents) * 20)));
    lines.push(`${day.date} ${bar} ${day.events.length}`);
  }
  lines.push("");

  // Prompt quality indicators
  const avgPromptsPerDay =
    totals.activeDays > 0
      ? (totals.prompts / totals.activeDays).toFixed(1)
      : "0";
  const toolsPerPrompt =
    totals.prompts > 0
      ? (totals.toolCalls / totals.prompts).toFixed(1)
      : "0";
  const correctionRate =
    totals.prompts > 0
      ? ((totals.corrections / totals.prompts) * 100).toFixed(1)
      : "0";

  lines.push(`## Quality Indicators`);
  lines.push("");
  lines.push(`- **Avg prompts/day:** ${avgPromptsPerDay}`);
  lines.push(`- **Tool calls per prompt:** ${toolsPerPrompt}`);
  lines.push(`- **Correction rate:** ${correctionRate}%`);
  lines.push(
    `- **Commit frequency:** ${totals.commits} commits over ${totals.activeDays} days`,
  );

  if (totals.errors > 0) {
    lines.push(`- **Errors:** ${totals.errors} ⚠️`);
  }
  if (totals.compactions > 0) {
    lines.push(`- **Compactions:** ${totals.compactions} (consider shorter sessions)`);
  }

  return lines.join("\n");
}

// ── Tool Registration ──────────────────────────────────────────────────────

export function registerExportReport(server: McpServer): void {
  server.tool(
    "export_report",
    "Export timeline data as a structured markdown report. Generates weekly summaries, detailed timelines, or activity digests with prompt quality trends, commit history, and error analysis.",
    {
      scope: z
        .enum(["current", "related", "all"])
        .default("current")
        .describe(
          "Search scope: current project, related projects, or all indexed",
        ),
      project: z
        .string()
        .optional()
        .describe("Filter to a specific project (overrides scope)"),
      since: z
        .string()
        .optional()
        .describe(
          "Start date — ISO string or relative like '7days', '2weeks', '1month'",
        ),
      until: z.string().optional().describe("End date (ISO or relative)"),
      format: z
        .enum(["weekly", "detailed", "digest"])
        .default("weekly")
        .describe(
          "Report format: weekly (summary stats + commits), detailed (full timeline), digest (compact activity overview)",
        ),
      save_to: z
        .string()
        .optional()
        .describe(
          "File path to save the report. If omitted, returns inline.",
        ),
    },
    async (params) => {
      const data = await collectReportData({
        scope: params.scope,
        project: params.project,
        since: params.since || "7days",
        until: params.until,
      });

      if (data.days.length === 0) {
        return {
          content: [
            {
              type: "text" as const,
              text: "No timeline data found for the given filters. Try broadening the time range or checking that projects are onboarded.",
            },
          ],
        };
      }

      let report: string;
      switch (params.format) {
        case "detailed":
          report = formatDetailedTimeline(data);
          break;
        case "digest":
          report = formatActivityDigest(data);
          break;
        case "weekly":
        default:
          report = formatWeeklySummary(data);
          break;
      }

      // Save to file if requested
      if (params.save_to) {
        try {
          mkdirSync(dirname(params.save_to), { recursive: true });
          writeFileSync(params.save_to, report, "utf-8");
          return {
            content: [
              {
                type: "text" as const,
                text: `✅ Report saved to \`${params.save_to}\`\n\n${report}`,
              },
            ],
          };
        } catch (err) {
          return {
            content: [
              {
                type: "text" as const,
                text: `⚠️ Failed to save report: ${err}\n\n${report}`,
              },
            ],
          };
        }
      }

      return { content: [{ type: "text" as const, text: report }] };
    },
  );
}
