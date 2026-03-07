import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getTimeline, listIndexedProjects } from "../lib/timeline-db.js";
import { getRelatedProjects } from "../lib/config.js";
import { writeFile, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
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
      return projects.map(p => p.project);
    }
    default:
      return currentProject ? [currentProject] : [];
  }
}

function getWeekKey(dateStr: string): string {
  const d = new Date(dateStr);
  // ISO week: get Monday of the week
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  const monday = new Date(d.setDate(diff));
  return monday.toISOString().slice(0, 10);
}

interface WeekStats {
  prompts: number;
  commits: number;
  corrections: number;
  toolCalls: number;
  errors: number;
  compactions: number;
  subAgents: number;
  assistantResponses: number;
  days: Set<string>;
}

function buildWeeklySummary(events: any[]): Map<string, WeekStats> {
  const weeks = new Map<string, WeekStats>();

  for (const event of events) {
    const weekKey = getWeekKey(event.timestamp);
    if (!weeks.has(weekKey)) {
      weeks.set(weekKey, {
        prompts: 0, commits: 0, corrections: 0, toolCalls: 0,
        errors: 0, compactions: 0, subAgents: 0, assistantResponses: 0,
        days: new Set(),
      });
    }
    const stats = weeks.get(weekKey)!;
    const day = new Date(event.timestamp).toISOString().slice(0, 10);
    stats.days.add(day);

    switch (event.type) {
      case "prompt": stats.prompts++; break;
      case "assistant": stats.assistantResponses++; break;
      case "commit": stats.commits++; break;
      case "correction": stats.corrections++; break;
      case "tool_call": stats.toolCalls++; break;
      case "error": stats.errors++; break;
      case "compaction": stats.compactions++; break;
      case "sub_agent_spawn": stats.subAgents++; break;
    }
  }

  return weeks;
}

function generateMarkdownReport(
  events: any[],
  projectName: string,
  dateRange: string,
  includeDetails: boolean,
): string {
  const lines: string[] = [];
  const now = new Date().toISOString().slice(0, 19).replace("T", " ");

  // Title
  lines.push(`# Session Report: ${projectName}`);
  lines.push(`_Generated ${now} | ${dateRange} | ${events.length} events_`);
  lines.push("");

  // Executive summary
  const typeCounts: Record<string, number> = {};
  for (const e of events) {
    typeCounts[e.type] = (typeCounts[e.type] || 0) + 1;
  }

  lines.push("## Summary");
  lines.push("");
  lines.push("| Metric | Count |");
  lines.push("|--------|-------|");
  for (const [type, count] of Object.entries(typeCounts).sort((a, b) => b[1] - a[1])) {
    const icon = TYPE_ICONS[type] || "❓";
    lines.push(`| ${icon} ${type} | ${count} |`);
  }
  lines.push("");

  // Correction rate (quality indicator)
  const totalPrompts = typeCounts["prompt"] || 0;
  const totalCorrections = typeCounts["correction"] || 0;
  if (totalPrompts > 0) {
    const correctionRate = ((totalCorrections / totalPrompts) * 100).toFixed(1);
    lines.push(`**Prompt quality indicator:** ${correctionRate}% correction rate (${totalCorrections}/${totalPrompts} prompts required correction)`);
    lines.push("");
  }

  // Weekly breakdown
  const weeklyStats = buildWeeklySummary(events);
  const sortedWeeks = [...weeklyStats.keys()].sort();

  if (sortedWeeks.length > 0) {
    lines.push("## Weekly Breakdown");
    lines.push("");
    lines.push("| Week of | Active Days | Prompts | Commits | Corrections | Errors |");
    lines.push("|---------|-------------|---------|---------|-------------|--------|");

    for (const week of sortedWeeks) {
      const s = weeklyStats.get(week)!;
      lines.push(`| ${week} | ${s.days.size} | ${s.prompts} | ${s.commits} | ${s.corrections} | ${s.errors} |`);
    }
    lines.push("");

    // Trends
    if (sortedWeeks.length >= 2) {
      lines.push("### Trends");
      lines.push("");
      const first = weeklyStats.get(sortedWeeks[0])!;
      const last = weeklyStats.get(sortedWeeks[sortedWeeks.length - 1])!;

      if (first.prompts > 0 && last.prompts > 0) {
        const firstRate = first.corrections / first.prompts;
        const lastRate = last.corrections / last.prompts;
        const direction = lastRate < firstRate ? "📈 Improving" : lastRate > firstRate ? "📉 Declining" : "➡️ Stable";
        lines.push(`- Correction rate trend: ${direction} (${(firstRate * 100).toFixed(1)}% → ${(lastRate * 100).toFixed(1)}%)`);
      }

      const commitTrend = last.commits > first.commits ? "📈 Increasing" : last.commits < first.commits ? "📉 Decreasing" : "➡️ Stable";
      lines.push(`- Commit velocity: ${commitTrend} (${first.commits} → ${last.commits}/week)`);
      lines.push("");
    }
  }

  // Detailed timeline (optional)
  if (includeDetails) {
    lines.push("## Detailed Timeline");
    lines.push("");

    const days = new Map<string, any[]>();
    for (const event of events) {
      const day = event.timestamp ? new Date(event.timestamp).toISOString().slice(0, 10) : "unknown";
      if (!days.has(day)) days.set(day, []);
      days.get(day)!.push(event);
    }

    const sortedDays = [...days.keys()].sort().reverse();
    for (const day of sortedDays) {
      lines.push(`### ${day}`);
      const dayEvents = days.get(day)!;
      dayEvents.sort((a: any, b: any) => {
        const ta = a.timestamp ? new Date(a.timestamp).getTime() : 0;
        const tb = b.timestamp ? new Date(b.timestamp).getTime() : 0;
        return ta - tb;
      });

      for (const event of dayEvents) {
        const time = event.timestamp
          ? new Date(event.timestamp).toISOString().slice(11, 16)
          : "??:??";
        const icon = TYPE_ICONS[event.type] || "❓";
        let content = (event.content || event.summary || "").slice(0, 200).replace(/\n/g, " ");

        if (event.type === "commit") {
          const hash = event.commit_hash ? event.commit_hash.slice(0, 7) + ": " : "";
          content = `\`${hash}${content}\``;
        } else if (event.type === "tool_call") {
          const tool = event.tool_name || "";
          const target = content ? ` → ${content}` : "";
          content = `\`${tool}\`${target}`;
        }

        lines.push(`- \`${time}\` ${icon} ${content}`);
      }
      lines.push("");
    }
  }

  return lines.join("\n");
}

export function registerExportTimeline(server: McpServer) {
  server.tool(
    "export_timeline",
    "Export timeline data as a formatted markdown report with weekly summaries, prompt quality trends, and activity breakdowns. Optionally save to a file.",
    {
      scope: z.enum(["current", "related", "all"]).default("current")
        .describe("Search scope: current project, related projects, or all indexed"),
      project: z.string().optional()
        .describe("Filter to a specific project (overrides scope)"),
      branch: z.string().optional(),
      since: z.string().optional()
        .describe("Start date (ISO or relative like '2weeks', '1month')"),
      until: z.string().optional()
        .describe("End date (ISO or relative)"),
      include_details: z.boolean().default(false)
        .describe("Include full detailed event timeline (can be long)"),
      save_path: z.string().optional()
        .describe("File path to save the report (e.g. './report.md'). If omitted, returns inline."),
      limit: z.number().default(500)
        .describe("Maximum events to include"),
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
          content: [{
            type: "text",
            text: `No projects found for scope "${params.scope}". Ensure CLAUDE_PROJECT_DIR is set or projects are onboarded.`,
          }],
        };
      }

      const events = await getTimeline({
        project_dirs: projectDirs,
        project: undefined,
        branch: params.branch,
        since,
        until,
        limit: params.limit,
        offset: 0,
      });

      if (events.length === 0) {
        return {
          content: [{
            type: "text",
            text: "No events found for the given filters. Nothing to export.",
          }],
        };
      }

      // Build date range string
      const timestamps = events.map((e: any) => e.timestamp).filter(Boolean).sort();
      const dateRange = timestamps.length > 1
        ? `${timestamps[0].slice(0, 10)} to ${timestamps[timestamps.length - 1].slice(0, 10)}`
        : timestamps[0]?.slice(0, 10) || "unknown";

      const projectName = params.project || (projectDirs.length === 1 ? projectDirs[0].split("/").pop() : `${projectDirs.length} projects`);

      const report = generateMarkdownReport(
        events,
        projectName!,
        dateRange,
        params.include_details,
      );

      // Save to file if requested
      if (params.save_path) {
        try {
          const dir = dirname(params.save_path);
          await mkdir(dir, { recursive: true });
          await writeFile(params.save_path, report, "utf-8");
          return {
            content: [{
              type: "text",
              text: `Report saved to \`${params.save_path}\` (${report.length} chars, ${events.length} events).\n\n${report}`,
            }],
          };
        } catch (err: any) {
          return {
            content: [{
              type: "text",
              text: `Failed to save report: ${err.message}\n\nReport content:\n\n${report}`,
            }],
          };
        }
      }

      return {
        content: [{
          type: "text",
          text: report,
        }],
      };
    },
  );
}
