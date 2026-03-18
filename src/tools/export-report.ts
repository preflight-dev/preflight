// =============================================================================
// export_report — Generate markdown reports from timeline data
// Addresses issue #5: Export timeline to markdown/PDF reports
// =============================================================================

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  getTimeline,
  listIndexedProjects,
  EVENT_TYPES,
  type TimelineRecord,
  type EventType,
} from "../lib/timeline-db.js";
import { getRelatedProjects } from "../lib/config.js";
import type { SearchScope } from "../types.js";
import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";

// ── Helpers ────────────────────────────────────────────────────────────────

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

function relativeDate(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString();
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function groupByDate(events: TimelineRecord[]): Map<string, TimelineRecord[]> {
  const groups = new Map<string, TimelineRecord[]>();
  for (const e of events) {
    const day = e.timestamp.slice(0, 10);
    if (!groups.has(day)) groups.set(day, []);
    groups.get(day)!.push(e);
  }
  return groups;
}

function groupByType(events: TimelineRecord[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const e of events) {
    counts.set(e.type, (counts.get(e.type) || 0) + 1);
  }
  return counts;
}

function truncate(s: string, max = 120): string {
  if (s.length <= max) return s;
  return s.slice(0, max) + "…";
}

// ── Report Generation ──────────────────────────────────────────────────────

interface ReportOptions {
  events: TimelineRecord[];
  projectName: string;
  period: string;
  since: string;
  until: string;
}

function generateSummarySection(opts: ReportOptions): string {
  const { events, period, since, until } = opts;
  const typeCounts = groupByType(events);
  const days = groupByDate(events);

  const lines: string[] = [];
  lines.push(`## Summary`);
  lines.push("");
  lines.push(`| Metric | Value |`);
  lines.push(`| --- | --- |`);
  lines.push(`| Period | ${period} |`);
  lines.push(`| Date range | ${formatDate(since)} → ${formatDate(until)} |`);
  lines.push(`| Total events | ${events.length} |`);
  lines.push(`| Active days | ${days.size} |`);
  lines.push(`| Sessions | ${new Set(events.map((e) => e.session_id)).size} |`);
  lines.push("");

  // Activity breakdown
  lines.push(`### Activity Breakdown`);
  lines.push("");
  const sorted = [...typeCounts.entries()].sort((a, b) => b[1] - a[1]);
  for (const [type, count] of sorted) {
    const icon = TYPE_ICONS[type] || "•";
    const pct = ((count / events.length) * 100).toFixed(1);
    lines.push(`- ${icon} **${type}**: ${count} (${pct}%)`);
  }
  lines.push("");

  return lines.join("\n");
}

function generateDailyBreakdown(events: TimelineRecord[]): string {
  const days = groupByDate(events);
  const lines: string[] = [];
  lines.push(`## Daily Breakdown`);
  lines.push("");

  for (const [date, dayEvents] of days) {
    const typeCounts = groupByType(dayEvents);
    const typeStr = [...typeCounts.entries()]
      .map(([t, c]) => `${TYPE_ICONS[t] || "•"} ${t}×${c}`)
      .join("  ");
    lines.push(`### ${formatDate(date)} (${dayEvents.length} events)`);
    lines.push(`${typeStr}`);
    lines.push("");

    // Show commits and corrections in detail
    const notable = dayEvents.filter(
      (e) => e.type === "commit" || e.type === "correction" || e.type === "error"
    );
    if (notable.length > 0) {
      for (const e of notable) {
        const icon = TYPE_ICONS[e.type] || "•";
        lines.push(
          `- ${icon} ${truncate(e.content_preview || e.content)}`
        );
      }
      lines.push("");
    }
  }

  return lines.join("\n");
}

function generateTrendSection(events: TimelineRecord[]): string {
  const days = groupByDate(events);
  const lines: string[] = [];
  lines.push(`## Trends`);
  lines.push("");

  // Prompt quality trend (corrections / prompts ratio per day)
  const dayStats: Array<{ date: string; prompts: number; corrections: number; ratio: number }> = [];
  for (const [date, dayEvents] of days) {
    const prompts = dayEvents.filter((e) => e.type === "prompt").length;
    const corrections = dayEvents.filter((e) => e.type === "correction").length;
    const ratio = prompts > 0 ? corrections / prompts : 0;
    dayStats.push({ date, prompts, corrections, ratio });
  }

  if (dayStats.some((d) => d.prompts > 0)) {
    lines.push(`### Correction Rate (lower is better)`);
    lines.push("");
    for (const d of dayStats) {
      const bar = "█".repeat(Math.round(d.ratio * 20));
      const pct = (d.ratio * 100).toFixed(0);
      lines.push(`${d.date}  ${bar || "▏"} ${pct}% (${d.corrections}/${d.prompts})`);
    }
    lines.push("");
  }

  // Activity heatmap
  lines.push(`### Daily Activity`);
  lines.push("");
  for (const [date, dayEvents] of days) {
    const bar = "█".repeat(Math.min(dayEvents.length, 50));
    lines.push(`${date}  ${bar} ${dayEvents.length}`);
  }
  lines.push("");

  return lines.join("\n");
}

function generateFullReport(opts: ReportOptions): string {
  const { projectName } = opts;
  const lines: string[] = [];
  lines.push(`# ${projectName} — Session Report`);
  lines.push(`_Generated ${new Date().toISOString()}_`);
  lines.push("");
  lines.push(generateSummarySection(opts));
  lines.push(generateTrendSection(opts.events));
  lines.push(generateDailyBreakdown(opts.events));
  return lines.join("\n");
}

// ── Tool Registration ──────────────────────────────────────────────────────

export function registerExportReport(server: McpServer): void {
  server.tool(
    "export_report",
    "Generate a markdown report from timeline data — weekly summaries, prompt quality trends, activity breakdown",
    {
      period: z
        .enum(["day", "week", "month", "quarter"])
        .default("week")
        .describe("Report period"),
      project: z
        .string()
        .optional()
        .describe("Project directory (defaults to current)"),
      output_path: z
        .string()
        .optional()
        .describe("Save report to file path (optional, returns content if omitted)"),
      scope: z
        .enum(["current", "related", "all"] satisfies SearchScope[])
        .default("current")
        .describe("Search scope"),
    },
    async (params) => {
      const periodDays: Record<string, number> = {
        day: 1,
        week: 7,
        month: 30,
        quarter: 90,
      };
      const days = periodDays[params.period];
      const since = relativeDate(days);
      const until = new Date().toISOString();

      // Resolve project directories
      let projectDirs: string[] = [];
      if (params.project) {
        projectDirs = [params.project];
      } else if (params.scope === "current") {
        if (process.env.CLAUDE_PROJECT_DIR) {
          projectDirs = [process.env.CLAUDE_PROJECT_DIR];
        }
      } else if (params.scope === "related") {
        const related = getRelatedProjects();
        projectDirs = related;
        if (process.env.CLAUDE_PROJECT_DIR) {
          projectDirs.unshift(process.env.CLAUDE_PROJECT_DIR);
        }
      }
      // scope=all leaves projectDirs empty → searches all indexed

      const events = await getTimeline({
        project_dirs: projectDirs.length > 0 ? projectDirs : undefined,
        since,
        until,
        limit: 5000,
      });

      if (events.length === 0) {
        return {
          content: [
            {
              type: "text" as const,
              text: `No timeline events found for the past ${params.period}. Make sure the project is indexed with \`onboard_project\`.`,
            },
          ],
        };
      }

      // Determine project name
      const projectName =
        events[0]?.project_name || events[0]?.project || "Unknown Project";

      const report = generateFullReport({
        events,
        projectName,
        period: params.period,
        since,
        until,
      });

      // Optionally write to file
      if (params.output_path) {
        const dir = params.output_path.includes("/")
          ? params.output_path.slice(0, params.output_path.lastIndexOf("/"))
          : ".";
        await mkdir(dir, { recursive: true }).catch(() => {});
        await writeFile(params.output_path, report, "utf-8");
        return {
          content: [
            {
              type: "text" as const,
              text: `Report saved to ${params.output_path}\n\n${report}`,
            },
          ],
        };
      }

      return {
        content: [
          {
            type: "text" as const,
            text: report,
          },
        ],
      };
    }
  );
}
