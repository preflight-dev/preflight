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

interface EventGroup {
  day: string;
  events: any[];
}

function groupByDay(events: any[]): EventGroup[] {
  const days = new Map<string, any[]>();
  for (const event of events) {
    const day = event.timestamp
      ? new Date(event.timestamp).toISOString().slice(0, 10)
      : "unknown";
    if (!days.has(day)) days.set(day, []);
    days.get(day)!.push(event);
  }
  // Sort days descending, events within day ascending
  const sorted = [...days.keys()].sort().reverse();
  return sorted.map((day) => {
    const dayEvents = days.get(day)!;
    dayEvents.sort((a: any, b: any) => {
      const ta = a.timestamp ? new Date(a.timestamp).getTime() : 0;
      const tb = b.timestamp ? new Date(b.timestamp).getTime() : 0;
      return ta - tb;
    });
    return { day, events: dayEvents };
  });
}

function computeStats(events: any[]) {
  const counts: Record<string, number> = {};
  for (const e of events) {
    counts[e.type] = (counts[e.type] || 0) + 1;
  }
  const totalPrompts = counts["prompt"] || 0;
  const totalCorrections = counts["correction"] || 0;
  const totalCommits = counts["commit"] || 0;
  const totalToolCalls = counts["tool_call"] || 0;
  const totalErrors = counts["error"] || 0;
  const correctionRate =
    totalPrompts > 0
      ? ((totalCorrections / totalPrompts) * 100).toFixed(1)
      : "0.0";
  return {
    total: events.length,
    prompts: totalPrompts,
    corrections: totalCorrections,
    commits: totalCommits,
    toolCalls: totalToolCalls,
    errors: totalErrors,
    correctionRate,
    counts,
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

function formatEventLine(event: any): string {
  const time = event.timestamp
    ? new Date(event.timestamp).toISOString().slice(11, 16)
    : "??:??";
  const icon = TYPE_ICONS[event.type] || "❓";
  let content = (event.content || event.summary || "")
    .slice(0, 200)
    .replace(/\n/g, " ");

  if (event.type === "commit") {
    const hash = event.commit_hash ? event.commit_hash.slice(0, 7) + ": " : "";
    content = `\`${hash}${content}\``;
  } else if (event.type === "tool_call") {
    const tool = event.tool_name || "";
    const target = content ? ` → ${content}` : "";
    content = `\`${tool}\`${target}`;
  } else {
    content = content ? `"${content}"` : "";
  }

  return `| ${time} | ${icon} ${event.type} | ${content} |`;
}

function renderMarkdown(
  events: any[],
  params: { project?: string; scope: string; since?: string; until?: string; title?: string }
): string {
  const groups = groupByDay(events);
  const stats = computeStats(events);
  const now = new Date().toISOString().slice(0, 10);
  const title = params.title || "Session Report";
  const proj = params.project || params.scope;

  const lines: string[] = [];

  // Front matter
  lines.push(`# ${title}`);
  lines.push("");
  lines.push(`**Project:** ${proj}  `);
  lines.push(`**Generated:** ${now}  `);
  if (params.since || params.until) {
    const range = [params.since || "start", params.until || "now"].join(" → ");
    lines.push(`**Period:** ${range}  `);
  }
  lines.push("");

  // Summary stats
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
  lines.push(`| Correction rate | ${stats.correctionRate}% |`);
  lines.push("");

  // Breakdown by type
  lines.push("## Event Breakdown");
  lines.push("");
  for (const [type, count] of Object.entries(stats.counts).sort(
    (a, b) => b[1] - a[1]
  )) {
    const icon = TYPE_ICONS[type] || "❓";
    const bar = "█".repeat(Math.min(Math.ceil((count / stats.total) * 40), 40));
    lines.push(`${icon} **${type}**: ${count} ${bar}`);
  }
  lines.push("");

  // Daily timeline
  lines.push("## Daily Timeline");
  lines.push("");

  for (const { day, events: dayEvents } of groups) {
    const dayStats = computeStats(dayEvents);
    lines.push(`### ${day} (${dayEvents.length} events)`);
    lines.push("");
    lines.push(`| Time | Type | Details |`);
    lines.push(`|------|------|---------|`);
    for (const event of dayEvents) {
      lines.push(formatEventLine(event));
    }
    lines.push("");

    // Day summary
    if (dayStats.commits > 0) {
      lines.push(
        `> **${day} summary:** ${dayStats.commits} commits, ${dayStats.prompts} prompts, ${dayStats.corrections} corrections`
      );
      lines.push("");
    }
  }

  // Trends section (corrections)
  if (stats.corrections > 0) {
    lines.push("## Correction Patterns");
    lines.push("");
    const corrections = events.filter((e: any) => e.type === "correction");
    for (const c of corrections.slice(0, 10)) {
      const content = (c.content || c.summary || "").slice(0, 300).replace(/\n/g, " ");
      const day = c.timestamp
        ? new Date(c.timestamp).toISOString().slice(0, 10)
        : "unknown";
      lines.push(`- **${day}**: ${content}`);
    }
    if (corrections.length > 10) {
      lines.push(`- _...and ${corrections.length - 10} more_`);
    }
    lines.push("");
  }

  lines.push("---");
  lines.push("_Generated by [preflight](https://github.com/TerminalGravity/preflight) export-timeline_");

  return lines.join("\n");
}

export function registerExportTimeline(server: McpServer) {
  server.tool(
    "export_timeline",
    "Export session timeline data as a structured Markdown report with summary statistics, daily breakdowns, correction patterns, and event trends. Use for weekly summaries, retrospectives, and prompt quality analysis.",
    {
      scope: z
        .enum(["current", "related", "all"])
        .default("current")
        .describe("Search scope"),
      project: z.string().optional().describe("Filter to specific project (overrides scope)"),
      since: z
        .string()
        .optional()
        .describe("Start date (ISO or relative like '1week', '30days')"),
      until: z.string().optional().describe("End date"),
      title: z.string().optional().describe("Report title (default: 'Session Report')"),
      limit: z.number().default(500).describe("Max events to include"),
    },
    async (params) => {
      const since = params.since ? parseRelativeDate(params.since) : undefined;
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
              type: "text",
              text: `No projects found for scope "${params.scope}". Set CLAUDE_PROJECT_DIR or onboard projects first.`,
            },
          ],
        };
      }

      const events = await getTimeline({
        project_dirs: projectDirs,
        project: undefined,
        since,
        until,
        limit: params.limit,
        offset: 0,
      });

      if (events.length === 0) {
        return {
          content: [
            {
              type: "text",
              text: "No events found for the given filters. Nothing to export.",
            },
          ],
        };
      }

      const markdown = renderMarkdown(events, {
        project: params.project,
        scope: params.scope,
        since: params.since,
        until: params.until,
        title: params.title,
      });

      return {
        content: [
          {
            type: "text",
            text: markdown,
          },
        ],
      };
    }
  );
}
