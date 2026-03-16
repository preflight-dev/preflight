// =============================================================================
// export_timeline — Generate markdown reports from timeline data (closes #5)
// =============================================================================

import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getTimeline, listIndexedProjects } from "../lib/timeline-db.js";
import { getRelatedProjects } from "../lib/config.js";
import { writeFile, mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { homedir } from "node:os";
import type { SearchScope } from "../types.js";

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

interface ReportStats {
  totalEvents: number;
  byType: Record<string, number>;
  byDay: Record<string, number>;
  firstEvent: string;
  lastEvent: string;
  activeDays: number;
}

function computeStats(events: any[]): ReportStats {
  const byType: Record<string, number> = {};
  const byDay: Record<string, number> = {};
  let firstEvent = "";
  let lastEvent = "";

  for (const e of events) {
    byType[e.type] = (byType[e.type] || 0) + 1;
    const day = e.timestamp ? new Date(e.timestamp).toISOString().slice(0, 10) : "unknown";
    byDay[day] = (byDay[day] || 0) + 1;
    if (!firstEvent || e.timestamp < firstEvent) firstEvent = e.timestamp;
    if (!lastEvent || e.timestamp > lastEvent) lastEvent = e.timestamp;
  }

  return {
    totalEvents: events.length,
    byType,
    byDay,
    firstEvent,
    lastEvent,
    activeDays: Object.keys(byDay).filter((d) => d !== "unknown").length,
  };
}

function formatSummarySection(stats: ReportStats): string {
  const lines: string[] = [
    "## Summary",
    "",
    `| Metric | Value |`,
    `|--------|-------|`,
    `| Total Events | ${stats.totalEvents} |`,
    `| Active Days | ${stats.activeDays} |`,
    `| Date Range | ${stats.firstEvent.slice(0, 10)} → ${stats.lastEvent.slice(0, 10)} |`,
    `| Avg Events/Day | ${(stats.totalEvents / Math.max(stats.activeDays, 1)).toFixed(1)} |`,
    "",
    "### Activity by Type",
    "",
    "| Type | Count | % |",
    "|------|-------|---|",
  ];

  const sorted = Object.entries(stats.byType).sort((a, b) => b[1] - a[1]);
  for (const [type, count] of sorted) {
    const pct = ((count / stats.totalEvents) * 100).toFixed(1);
    const icon = TYPE_ICONS[type] || "❓";
    lines.push(`| ${icon} ${TYPE_LABELS[type] || type} | ${count} | ${pct}% |`);
  }

  return lines.join("\n");
}

function formatDailyBreakdown(events: any[]): string {
  const days = new Map<string, any[]>();
  for (const event of events) {
    const day = event.timestamp ? new Date(event.timestamp).toISOString().slice(0, 10) : "unknown";
    if (!days.has(day)) days.set(day, []);
    days.get(day)!.push(event);
  }

  const sortedDays = [...days.keys()].sort().reverse();
  const lines: string[] = ["## Daily Breakdown", ""];

  for (const day of sortedDays) {
    const dayEvents = days.get(day)!;
    dayEvents.sort((a: any, b: any) => {
      const ta = a.timestamp ? new Date(a.timestamp).getTime() : 0;
      const tb = b.timestamp ? new Date(b.timestamp).getTime() : 0;
      return ta - tb;
    });

    // Day header with counts
    const typeCounts = dayEvents.reduce(
      (acc: Record<string, number>, e: any) => {
        acc[e.type] = (acc[e.type] || 0) + 1;
        return acc;
      },
      {},
    );
    const countStr = Object.entries(typeCounts)
      .map(([t, c]) => `${TYPE_ICONS[t] || "❓"}${c}`)
      .join(" ");

    lines.push(`### ${day} (${dayEvents.length} events: ${countStr})`);
    lines.push("");

    for (const event of dayEvents) {
      const time = event.timestamp
        ? new Date(event.timestamp).toISOString().slice(11, 16)
        : "??:??";
      const icon = TYPE_ICONS[event.type] || "❓";
      let content = (event.content || event.summary || "").slice(0, 200).replace(/\n/g, " ");

      if (event.type === "commit") {
        const hash = event.commit_hash ? event.commit_hash.slice(0, 7) + " " : "";
        content = `\`${hash}\` ${content}`;
      } else if (event.type === "tool_call") {
        const tool = event.tool_name || "";
        content = tool + (content ? ` → ${content}` : "");
      }

      lines.push(`- **${time}** ${icon} ${content}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

function formatWeeklySummary(stats: ReportStats): string {
  // Group days into weeks
  const weeks = new Map<string, number>();
  for (const [day, count] of Object.entries(stats.byDay)) {
    if (day === "unknown") continue;
    const d = new Date(day);
    // Get Monday of that week
    const dayOfWeek = d.getDay();
    const monday = new Date(d);
    monday.setDate(d.getDate() - ((dayOfWeek + 6) % 7));
    const weekKey = monday.toISOString().slice(0, 10);
    weeks.set(weekKey, (weeks.get(weekKey) || 0) + count);
  }

  if (weeks.size === 0) return "";

  const sorted = [...weeks.entries()].sort((a, b) => b[0].localeCompare(a[0]));
  const lines: string[] = [
    "## Weekly Trend",
    "",
    "| Week Starting | Events | Bar |",
    "|---------------|--------|-----|",
  ];

  const maxCount = Math.max(...sorted.map(([, c]) => c));
  for (const [week, count] of sorted) {
    const barLen = Math.round((count / maxCount) * 20);
    const bar = "█".repeat(barLen) + "░".repeat(20 - barLen);
    lines.push(`| ${week} | ${count} | \`${bar}\` |`);
  }

  return lines.join("\n");
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

export function registerExportTimeline(server: McpServer) {
  server.tool(
    "export_timeline",
    "Export timeline data as a structured markdown report. Generates summaries, daily breakdowns, activity stats, and weekly trends. Optionally saves to a file.",
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
        .describe("Start date (ISO or relative like '7days', '2weeks')"),
      until: z.string().optional().describe("End date"),
      type: z
        .enum([
          "prompt",
          "assistant",
          "correction",
          "commit",
          "tool_call",
          "compaction",
          "sub_agent_spawn",
          "error",
          "all",
        ])
        .default("all"),
      format: z
        .enum(["summary", "detailed", "weekly"])
        .default("detailed")
        .describe(
          "Report format: summary (stats only), detailed (full daily breakdown), weekly (week-level trends)",
        ),
      save_to: z
        .string()
        .optional()
        .describe(
          "File path to save the report. If omitted, returns inline.",
        ),
      limit: z.number().default(500).describe("Max events to include"),
    },
    async (params) => {
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
        else if (unit.startsWith("year"))
          d.setFullYear(d.getFullYear() - num);
        return d.toISOString();
      }

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
              text: `No projects found for scope "${params.scope}".`,
            },
          ],
        };
      }

      const events = await getTimeline({
        project_dirs: projectDirs,
        project: undefined,
        type: params.type === "all" ? undefined : params.type,
        since,
        until,
        limit: params.limit,
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
      const now = new Date().toISOString().slice(0, 19).replace("T", " ");
      const proj = params.project || projectDirs.join(", ");

      // Build report
      const sections: string[] = [
        `# Preflight Timeline Report`,
        ``,
        `> Generated: ${now}  `,
        `> Project: ${proj}  `,
        `> Period: ${stats.firstEvent.slice(0, 10)} → ${stats.lastEvent.slice(0, 10)}  `,
        `> Events: ${stats.totalEvents}`,
        "",
        "---",
        "",
      ];

      // Always include summary
      sections.push(formatSummarySection(stats));
      sections.push("");

      if (params.format === "detailed") {
        sections.push(formatDailyBreakdown(events));
      }

      if (params.format === "weekly" || params.format === "detailed") {
        const weekly = formatWeeklySummary(stats);
        if (weekly) {
          sections.push(weekly);
          sections.push("");
        }
      }

      sections.push("---");
      sections.push("_Report generated by [Preflight](https://github.com/TerminalGravity/preflight)_");

      const report = sections.join("\n");

      // Optionally save to file
      if (params.save_to) {
        const filePath = resolve(params.save_to);
        const dir = join(filePath, "..");
        await mkdir(dir, { recursive: true });
        await writeFile(filePath, report, "utf-8");
        return {
          content: [
            {
              type: "text" as const,
              text: `Report saved to \`${filePath}\` (${report.length} chars, ${stats.totalEvents} events).\n\n${report}`,
            },
          ],
        };
      }

      return { content: [{ type: "text" as const, text: report }] };
    },
  );
}
