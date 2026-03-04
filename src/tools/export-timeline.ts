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

interface DaySummary {
  prompts: number;
  commits: number;
  corrections: number;
  toolCalls: number;
  errors: number;
}

function computeDaySummary(events: any[]): DaySummary {
  const s: DaySummary = { prompts: 0, commits: 0, corrections: 0, toolCalls: 0, errors: 0 };
  for (const e of events) {
    if (e.type === "prompt") s.prompts++;
    else if (e.type === "commit") s.commits++;
    else if (e.type === "correction") s.corrections++;
    else if (e.type === "tool_call") s.toolCalls++;
    else if (e.type === "error") s.errors++;
  }
  return s;
}

function renderWeeklySummary(weeks: Map<string, any[]>): string[] {
  const lines: string[] = [];
  const sortedWeeks = [...weeks.keys()].sort().reverse();

  for (const weekKey of sortedWeeks) {
    const events = weeks.get(weekKey)!;
    const summary = computeDaySummary(events);
    lines.push(`### Week of ${weekKey}`);
    lines.push("");
    lines.push(`| Metric | Count |`);
    lines.push(`|--------|-------|`);
    lines.push(`| Prompts | ${summary.prompts} |`);
    lines.push(`| Commits | ${summary.commits} |`);
    lines.push(`| Corrections | ${summary.corrections} |`);
    lines.push(`| Tool calls | ${summary.toolCalls} |`);
    lines.push(`| Errors | ${summary.errors} |`);
    if (summary.prompts > 0) {
      const corrRate = ((summary.corrections / summary.prompts) * 100).toFixed(1);
      lines.push(`| Correction rate | ${corrRate}% |`);
    }
    lines.push("");
  }
  return lines;
}

function getWeekStart(dateStr: string): string {
  const d = new Date(dateStr);
  const day = d.getUTCDay();
  d.setUTCDate(d.getUTCDate() - day);
  return d.toISOString().slice(0, 10);
}

export function registerExportTimeline(server: McpServer) {
  server.tool(
    "export_timeline",
    "Export timeline data as a structured markdown report with summaries, trends, and stats. Useful for weekly reviews, standups, or sharing progress.",
    {
      scope: z
        .enum(["current", "related", "all"])
        .default("current")
        .describe("Search scope"),
      project: z.string().optional().describe("Filter to specific project (overrides scope)"),
      branch: z.string().optional(),
      author: z.string().optional().describe("Filter commits by author"),
      since: z.string().optional().describe("Start date (ISO or relative like '7days', '2weeks')"),
      until: z.string().optional().describe("End date"),
      format: z
        .enum(["full", "summary", "daily"])
        .default("summary")
        .describe("Report format: full (all events), summary (weekly aggregates), daily (day-by-day breakdown)"),
    },
    async (params) => {
      const since = params.since
        ? parseRelativeDate(params.since)
        : parseRelativeDate("2weeks");
      const until = params.until ? parseRelativeDate(params.until) : undefined;

      let projectDirs: string[];
      if (params.project) {
        projectDirs = [params.project];
      } else {
        projectDirs = await getSearchProjects(params.scope);
      }

      let events = await getTimeline({
        project_dirs: projectDirs,
        branch: params.branch,
        type: undefined,
        since,
        until,
        limit: 500,
        offset: 0,
      });

      if (params.author) {
        const authorLower = params.author.toLowerCase();
        events = events.filter((e: any) => {
          if (e.type !== "commit") return true;
          try {
            const meta = JSON.parse(e.metadata || "{}");
            return (meta.author || "").toLowerCase().includes(authorLower);
          } catch {
            return true;
          }
        });
      }

      if (events.length === 0) {
        return {
          content: [
            {
              type: "text" as const,
              text: "# Timeline Report\n\n_No events found for the given filters._",
            },
          ],
        };
      }

      // Group by day
      const days = new Map<string, any[]>();
      for (const event of events) {
        const day = event.timestamp
          ? new Date(event.timestamp).toISOString().slice(0, 10)
          : "unknown";
        if (!days.has(day)) days.set(day, []);
        days.get(day)!.push(event);
      }

      const proj = params.project || projectDirs.join(", ") || "all projects";
      const sortedDays = [...days.keys()].sort().reverse();
      const dateRange =
        sortedDays.length > 1
          ? `${sortedDays[sortedDays.length - 1]} → ${sortedDays[0]}`
          : sortedDays[0];

      const lines: string[] = [
        `# Timeline Report`,
        "",
        `**Project:** ${proj}`,
        `**Period:** ${dateRange}`,
        `**Events:** ${events.length}`,
        `**Generated:** ${new Date().toISOString().slice(0, 16)}`,
        "",
        "---",
        "",
      ];

      // Overall summary
      const overall = computeDaySummary(events);
      lines.push("## Overview");
      lines.push("");
      lines.push(`| Metric | Total |`);
      lines.push(`|--------|-------|`);
      lines.push(`| 💬 Prompts | ${overall.prompts} |`);
      lines.push(`| 📦 Commits | ${overall.commits} |`);
      lines.push(`| ❌ Corrections | ${overall.corrections} |`);
      lines.push(`| 🔧 Tool calls | ${overall.toolCalls} |`);
      lines.push(`| ⚠️ Errors | ${overall.errors} |`);
      if (overall.prompts > 0) {
        const corrRate = ((overall.corrections / overall.prompts) * 100).toFixed(1);
        lines.push(`| 📊 Correction rate | ${corrRate}% |`);
      }
      lines.push("");

      if (params.format === "summary" || params.format === "full") {
        // Group by week
        const weeks = new Map<string, any[]>();
        for (const event of events) {
          const weekStart = event.timestamp
            ? getWeekStart(event.timestamp)
            : "unknown";
          if (!weeks.has(weekStart)) weeks.set(weekStart, []);
          weeks.get(weekStart)!.push(event);
        }
        lines.push("## Weekly Breakdown");
        lines.push("");
        lines.push(...renderWeeklySummary(weeks));
      }

      if (params.format === "daily" || params.format === "full") {
        lines.push("## Daily Detail");
        lines.push("");

        for (const day of sortedDays) {
          const dayEvents = days.get(day)!;
          const daySummary = computeDaySummary(dayEvents);
          lines.push(
            `### ${day} — ${dayEvents.length} events (${daySummary.prompts}💬 ${daySummary.commits}📦 ${daySummary.corrections}❌)`
          );
          lines.push("");

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
            let content = (event.content || event.summary || "")
              .slice(0, 150)
              .replace(/\n/g, " ");

            if (event.type === "commit") {
              const hash = event.commit_hash
                ? event.commit_hash.slice(0, 7) + ": "
                : "";
              content = `\`${hash}${content}\``;
            } else if (event.type === "tool_call") {
              const tool = event.tool_name || "";
              const target = content ? ` → ${content}` : "";
              content = `**${tool}**${target}`;
            }

            lines.push(`- \`${time}\` ${icon} ${content}`);
          }
          lines.push("");
        }
      }

      // Prompt quality trend (if we have correction data)
      if (overall.prompts > 5 && params.format !== "daily") {
        lines.push("## Prompt Quality Trend");
        lines.push("");
        lines.push("| Day | Prompts | Corrections | Rate |");
        lines.push("|-----|---------|-------------|------|");
        for (const day of sortedDays) {
          const dayEvents = days.get(day)!;
          const ds = computeDaySummary(dayEvents);
          if (ds.prompts > 0) {
            const rate = ((ds.corrections / ds.prompts) * 100).toFixed(1);
            lines.push(`| ${day} | ${ds.prompts} | ${ds.corrections} | ${rate}% |`);
          }
        }
        lines.push("");
      }

      return {
        content: [{ type: "text" as const, text: lines.join("\n") }],
      };
    }
  );
}
