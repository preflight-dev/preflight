// =============================================================================
// export_timeline — Generate markdown reports from timeline data (Issue #5)
// =============================================================================

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getTimeline, listIndexedProjects } from "../lib/timeline-db.js";
import { getRelatedProjects } from "../lib/config.js";
import { writeFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import type { SearchScope } from "../types.js";

// ── Helpers ────────────────────────────────────────────────────────────────

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

function defaultSince(period: string): string {
  const d = new Date();
  switch (period) {
    case "daily":
      d.setDate(d.getDate() - 1);
      break;
    case "weekly":
      d.setDate(d.getDate() - 7);
      break;
    case "monthly":
      d.setMonth(d.getMonth() - 1);
      break;
    default:
      d.setDate(d.getDate() - 7);
  }
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

// ── Report generators ──────────────────────────────────────────────────────

interface ReportEvent {
  timestamp: string;
  type: string;
  content?: string;
  summary?: string;
  commit_hash?: string;
  tool_name?: string;
  metadata?: string;
  session_id?: string;
  project?: string;
  project_name?: string;
}

function generateSummaryStats(events: ReportEvent[]): string[] {
  const counts: Record<string, number> = {};
  for (const e of events) {
    counts[e.type] = (counts[e.type] || 0) + 1;
  }

  const lines: string[] = ["## Summary", ""];
  lines.push(`| Metric | Count |`);
  lines.push(`|--------|-------|`);
  lines.push(`| Total events | ${events.length} |`);

  for (const [type, count] of Object.entries(counts).sort(
    (a, b) => b[1] - a[1]
  )) {
    const icon = TYPE_ICONS[type] || "❓";
    lines.push(`| ${icon} ${type} | ${count} |`);
  }

  // Correction rate
  const prompts = counts["prompt"] || 0;
  const corrections = counts["correction"] || 0;
  if (prompts > 0) {
    const rate = ((corrections / prompts) * 100).toFixed(1);
    lines.push(`| Correction rate | ${rate}% |`);
  }

  // Unique sessions
  const sessions = new Set(events.map((e) => e.session_id).filter(Boolean));
  lines.push(`| Sessions | ${sessions.size} |`);

  lines.push("");
  return lines;
}

function generateDailyBreakdown(events: ReportEvent[]): string[] {
  const days = new Map<string, ReportEvent[]>();
  for (const event of events) {
    const day = event.timestamp
      ? new Date(event.timestamp).toISOString().slice(0, 10)
      : "unknown";
    if (!days.has(day)) days.set(day, []);
    days.get(day)!.push(event);
  }

  const lines: string[] = ["## Daily Breakdown", ""];
  const sortedDays = [...days.keys()].sort().reverse();

  for (const day of sortedDays) {
    const dayEvents = days.get(day)!;
    const counts: Record<string, number> = {};
    for (const e of dayEvents) {
      counts[e.type] = (counts[e.type] || 0) + 1;
    }

    const badges = Object.entries(counts)
      .map(([t, c]) => `${TYPE_ICONS[t] || "❓"}${c}`)
      .join(" ");

    lines.push(`### ${day} (${dayEvents.length} events)`);
    lines.push(`${badges}`);
    lines.push("");

    // Show commits for the day
    const commits = dayEvents.filter((e) => e.type === "commit");
    if (commits.length > 0) {
      lines.push("**Commits:**");
      for (const c of commits) {
        const hash = c.commit_hash ? c.commit_hash.slice(0, 7) : "???????";
        const msg = (c.content || c.summary || "").slice(0, 100).replace(/\n/g, " ");
        lines.push(`- \`${hash}\` ${msg}`);
      }
      lines.push("");
    }

    // Show corrections for the day
    const corrections = dayEvents.filter((e) => e.type === "correction");
    if (corrections.length > 0) {
      lines.push("**Corrections:**");
      for (const c of corrections) {
        const msg = (c.content || c.summary || "").slice(0, 120).replace(/\n/g, " ");
        lines.push(`- ${msg}`);
      }
      lines.push("");
    }

    // Show errors
    const errors = dayEvents.filter((e) => e.type === "error");
    if (errors.length > 0) {
      lines.push("**Errors:**");
      for (const e of errors) {
        const msg = (e.content || e.summary || "").slice(0, 120).replace(/\n/g, " ");
        lines.push(`- ⚠️ ${msg}`);
      }
      lines.push("");
    }
  }

  return lines;
}

function generateToolUsageSection(events: ReportEvent[]): string[] {
  const toolCalls = events.filter((e) => e.type === "tool_call");
  if (toolCalls.length === 0) return [];

  const toolCounts: Record<string, number> = {};
  for (const tc of toolCalls) {
    const name = tc.tool_name || "unknown";
    toolCounts[name] = (toolCounts[name] || 0) + 1;
  }

  const sorted = Object.entries(toolCounts).sort((a, b) => b[1] - a[1]);
  const lines: string[] = ["## Tool Usage", ""];
  lines.push("| Tool | Calls |");
  lines.push("|------|-------|");
  for (const [tool, count] of sorted.slice(0, 20)) {
    lines.push(`| ${tool} | ${count} |`);
  }
  lines.push("");
  return lines;
}

function buildReport(
  events: ReportEvent[],
  period: string,
  projectLabel: string,
  since: string,
  until?: string
): string {
  const now = new Date().toISOString().slice(0, 10);
  const sinceDate = new Date(since).toISOString().slice(0, 10);
  const untilDate = until ? new Date(until).toISOString().slice(0, 10) : now;

  const lines: string[] = [
    `# ${period.charAt(0).toUpperCase() + period.slice(1)} Report: ${projectLabel}`,
    "",
    `**Period:** ${sinceDate} → ${untilDate}  `,
    `**Generated:** ${now}`,
    "",
    ...generateSummaryStats(events),
    ...generateDailyBreakdown(events),
    ...generateToolUsageSection(events),
    "---",
    `_Generated by preflight export_timeline_`,
  ];

  return lines.join("\n");
}

// ── Registration ───────────────────────────────────────────────────────────

export function registerExportTimeline(server: McpServer) {
  server.tool(
    "export_timeline",
    "Generate a markdown report from timeline data. Summarizes activity, commits, corrections, tool usage, and daily breakdown for a given period.",
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
        .enum(["daily", "weekly", "monthly"])
        .default("weekly")
        .describe("Report period — sets default date range if since is omitted"),
      since: z
        .string()
        .optional()
        .describe("Start date (ISO or relative like '7days')"),
      until: z
        .string()
        .optional()
        .describe("End date (ISO or relative)"),
      save: z
        .boolean()
        .default(false)
        .describe("Save report to ~/.preflight/reports/"),
    },
    async (params) => {
      const since = params.since
        ? parseRelativeDate(params.since)
        : defaultSince(params.period);
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
              text: `No projects found for scope "${params.scope}". Make sure CLAUDE_PROJECT_DIR is set or projects are onboarded.`,
            },
          ],
        };
      }

      const events = (await getTimeline({
        project_dirs: projectDirs,
        project: undefined,
        since,
        until,
        limit: 5000,
        offset: 0,
      })) as ReportEvent[];

      if (events.length === 0) {
        return {
          content: [
            {
              type: "text" as const,
              text: "No events found for the given period. Nothing to report.",
            },
          ],
        };
      }

      const projectLabel =
        params.project || (params.scope === "current" ? "current project" : params.scope);
      const report = buildReport(events, params.period, projectLabel, since, until);

      // Optionally save to disk
      let savedPath: string | undefined;
      if (params.save) {
        const reportsDir = join(homedir(), ".preflight", "reports");
        if (!existsSync(reportsDir)) {
          mkdirSync(reportsDir, { recursive: true });
        }
        const filename = `${params.period}-${new Date().toISOString().slice(0, 10)}.md`;
        savedPath = join(reportsDir, filename);
        writeFileSync(savedPath, report, "utf-8");
      }

      const footer = savedPath ? `\n\n_Saved to \`${savedPath}\`_` : "";

      return {
        content: [{ type: "text" as const, text: report + footer }],
      };
    }
  );
}
