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
      return projects.map(p => p.project);
    }
    default:
      return currentProject ? [currentProject] : [];
  }
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

interface EventStats {
  total: number;
  byType: Record<string, number>;
  byDay: Record<string, number>;
  corrections: number;
  errors: number;
  commits: number;
  sessions: Set<string>;
}

function computeStats(events: any[]): EventStats {
  const stats: EventStats = {
    total: events.length,
    byType: {},
    byDay: {},
    corrections: 0,
    errors: 0,
    commits: 0,
    sessions: new Set(),
  };

  for (const e of events) {
    stats.byType[e.type] = (stats.byType[e.type] || 0) + 1;
    const day = e.timestamp ? new Date(e.timestamp).toISOString().slice(0, 10) : "unknown";
    stats.byDay[day] = (stats.byDay[day] || 0) + 1;
    if (e.type === "correction") stats.corrections++;
    if (e.type === "error") stats.errors++;
    if (e.type === "commit") stats.commits++;
    if (e.session_id) stats.sessions.add(e.session_id);
  }

  return stats;
}

function renderMarkdownReport(
  events: any[],
  stats: EventStats,
  opts: { project: string; since?: string; until?: string; format: string },
): string {
  const lines: string[] = [];
  const now = new Date().toISOString().slice(0, 10);

  lines.push(`# Session Report: ${opts.project}`);
  lines.push(`_Generated ${now}_`);
  lines.push("");

  // Summary section
  lines.push("## Summary");
  lines.push("");
  lines.push(`- **Period:** ${opts.since || "start"} → ${opts.until || "now"}`);
  lines.push(`- **Total events:** ${stats.total}`);
  lines.push(`- **Sessions:** ${stats.sessions.size}`);
  lines.push(`- **Commits:** ${stats.commits}`);
  lines.push(`- **Corrections:** ${stats.corrections}`);
  lines.push(`- **Errors:** ${stats.errors}`);
  lines.push("");

  // Activity breakdown
  lines.push("## Activity Breakdown");
  lines.push("");
  for (const [type, count] of Object.entries(stats.byType).sort((a, b) => b[1] - a[1])) {
    const icon = TYPE_ICONS[type] || "❓";
    const pct = ((count / stats.total) * 100).toFixed(1);
    lines.push(`- ${icon} **${type}**: ${count} (${pct}%)`);
  }
  lines.push("");

  // Daily activity
  const sortedDays = Object.keys(stats.byDay).sort().reverse();
  lines.push("## Daily Activity");
  lines.push("");
  for (const day of sortedDays) {
    const count = stats.byDay[day];
    const bar = "█".repeat(Math.min(Math.ceil(count / 2), 30));
    lines.push(`- **${day}**: ${bar} ${count}`);
  }
  lines.push("");

  if (opts.format === "detailed") {
    // Full timeline
    lines.push("## Timeline");
    lines.push("");

    const days = new Map<string, any[]>();
    for (const event of events) {
      const day = event.timestamp ? new Date(event.timestamp).toISOString().slice(0, 10) : "unknown";
      if (!days.has(day)) days.set(day, []);
      days.get(day)!.push(event);
    }

    for (const day of sortedDays) {
      lines.push(`### ${day}`);
      const dayEvents = days.get(day) || [];
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

        lines.push(`- ${time} ${icon} ${content}`);
      }
      lines.push("");
    }
  }

  // Correction highlights
  const corrections = events.filter(e => e.type === "correction");
  if (corrections.length > 0) {
    lines.push("## Corrections");
    lines.push("");
    lines.push("_Mistakes caught and corrected during sessions:_");
    lines.push("");
    for (const c of corrections.slice(0, 20)) {
      const time = c.timestamp ? new Date(c.timestamp).toISOString().slice(0, 16).replace("T", " ") : "unknown";
      const content = (c.content || "").slice(0, 150).replace(/\n/g, " ");
      lines.push(`- **${time}**: ${content}`);
    }
    lines.push("");
  }

  // Quality signal
  if (stats.total > 0) {
    const correctionRate = ((stats.corrections / stats.total) * 100).toFixed(1);
    const errorRate = ((stats.errors / stats.total) * 100).toFixed(1);
    lines.push("## Quality Signals");
    lines.push("");
    lines.push(`- **Correction rate:** ${correctionRate}%`);
    lines.push(`- **Error rate:** ${errorRate}%`);
    if (stats.corrections === 0 && stats.errors === 0) {
      lines.push("- ✅ Clean session — no corrections or errors recorded");
    }
    lines.push("");
  }

  lines.push("---");
  lines.push("_Report generated by [preflight](https://github.com/TerminalGravity/preflight) export_timeline tool._");

  return lines.join("\n");
}

export function registerExportTimeline(server: McpServer) {
  server.tool(
    "export_timeline",
    "Generate a markdown report from timeline data. Includes summary stats, daily activity chart, quality signals, and optionally the full event timeline.",
    {
      scope: z.enum(["current", "related", "all"]).default("current").describe("Search scope"),
      project: z.string().optional().describe("Filter to a specific project (overrides scope)"),
      since: z.string().optional().describe("Start date (ISO or relative like '7days', '2weeks')"),
      until: z.string().optional().describe("End date (ISO or relative)"),
      format: z.enum(["summary", "detailed"]).default("summary").describe("'summary' = stats only, 'detailed' = stats + full timeline"),
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
          content: [{
            type: "text",
            text: `No projects found for scope "${params.scope}". Set CLAUDE_PROJECT_DIR or onboard a project first.`,
          }],
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
          content: [{
            type: "text",
            text: "No events found for the given filters. Nothing to export.",
          }],
        };
      }

      const stats = computeStats(events);
      const projectLabel = params.project || projectDirs.join(", ");
      const report = renderMarkdownReport(events, stats, {
        project: projectLabel,
        since,
        until,
        format: params.format,
      });

      return {
        content: [{ type: "text", text: report }],
      };
    },
  );
}
