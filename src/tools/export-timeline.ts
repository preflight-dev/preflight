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
  byDay: Map<string, number>;
  firstEvent: string;
  lastEvent: string;
  uniqueSessions: Set<string>;
  uniqueBranches: Set<string>;
}

function computeStats(events: any[]): EventStats {
  const stats: EventStats = {
    total: events.length,
    byType: {},
    byDay: new Map(),
    firstEvent: "",
    lastEvent: "",
    uniqueSessions: new Set(),
    uniqueBranches: new Set(),
  };

  for (const e of events) {
    // By type
    stats.byType[e.type] = (stats.byType[e.type] || 0) + 1;

    // By day
    const day = e.timestamp ? new Date(e.timestamp).toISOString().slice(0, 10) : "unknown";
    stats.byDay.set(day, (stats.byDay.get(day) || 0) + 1);

    // Sessions & branches
    if (e.session_id) stats.uniqueSessions.add(e.session_id);
    if (e.branch) stats.uniqueBranches.add(e.branch);
  }

  const timestamps = events
    .filter((e: any) => e.timestamp)
    .map((e: any) => e.timestamp)
    .sort();
  stats.firstEvent = timestamps[0] || "N/A";
  stats.lastEvent = timestamps[timestamps.length - 1] || "N/A";

  return stats;
}

export function registerExportTimeline(server: McpServer) {
  server.tool(
    "export_timeline",
    "Export timeline data as a structured markdown report with summary statistics, activity breakdown, and event details. Useful for weekly summaries, sprint retrospectives, and session analysis.",
    {
      scope: z.enum(["current", "related", "all"]).default("current").describe("Search scope"),
      project: z.string().optional().describe("Filter to a specific project (overrides scope)"),
      branch: z.string().optional(),
      author: z.string().optional().describe("Filter commits by author"),
      since: z.string().optional().describe("Start date (ISO or relative like '7days', '2weeks')"),
      until: z.string().optional().describe("End date"),
      type: z.enum(["prompt", "assistant", "correction", "commit", "tool_call", "compaction", "sub_agent_spawn", "error", "all"]).default("all"),
      limit: z.number().default(500).describe("Max events to include"),
      include_details: z.boolean().default(true).describe("Include per-event detail section"),
      title: z.string().optional().describe("Custom report title"),
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
            text: `# Timeline Report\n\n_No projects found for scope "${params.scope}"._`,
          }],
        };
      }

      let events: any[] = await getTimeline({
        project_dirs: projectDirs,
        project: undefined,
        branch: params.branch,
        since,
        until,
        type: params.type === "all" ? undefined : params.type,
        limit: params.limit,
        offset: 0,
      });

      // Author filter
      if (params.author) {
        const authorLower = params.author.toLowerCase();
        events = events.filter((e: any) => {
          if (e.type !== "commit") return true;
          try {
            const meta = JSON.parse(e.metadata || "{}");
            return (meta.author || "").toLowerCase().includes(authorLower);
          } catch { return true; }
        });
      }

      if (events.length === 0) {
        return {
          content: [{
            type: "text",
            text: `# Timeline Report\n\n_No events found for the given filters._`,
          }],
        };
      }

      const stats = computeStats(events);
      const proj = params.project || params.scope;
      const reportTitle = params.title || `Timeline Report: ${proj}`;
      const generatedAt = new Date().toISOString().slice(0, 19).replace("T", " ");

      const lines: string[] = [];

      // Header
      lines.push(`# ${reportTitle}`);
      lines.push("");
      lines.push(`_Generated: ${generatedAt}_`);
      lines.push("");

      // Summary
      lines.push("## Summary");
      lines.push("");
      lines.push(`| Metric | Value |`);
      lines.push(`|--------|-------|`);
      lines.push(`| Total events | ${stats.total} |`);
      lines.push(`| Date range | ${stats.firstEvent.slice(0, 10)} → ${stats.lastEvent.slice(0, 10)} |`);
      lines.push(`| Active days | ${stats.byDay.size} |`);
      lines.push(`| Sessions | ${stats.uniqueSessions.size} |`);
      lines.push(`| Branches | ${stats.uniqueBranches.size} |`);
      lines.push("");

      // Activity breakdown
      lines.push("## Activity Breakdown");
      lines.push("");
      lines.push("| Type | Count | % |");
      lines.push("|------|-------|---|");
      const sortedTypes = Object.entries(stats.byType).sort((a, b) => b[1] - a[1]);
      for (const [type, count] of sortedTypes) {
        const icon = TYPE_ICONS[type] || "❓";
        const pct = ((count / stats.total) * 100).toFixed(1);
        lines.push(`| ${icon} ${type} | ${count} | ${pct}% |`);
      }
      lines.push("");

      // Daily activity
      lines.push("## Daily Activity");
      lines.push("");
      const sortedDays = [...stats.byDay.entries()].sort((a, b) => b[0].localeCompare(a[0]));
      for (const [day, count] of sortedDays) {
        const bar = "█".repeat(Math.min(count, 40));
        lines.push(`- **${day}**: ${bar} (${count})`);
      }
      lines.push("");

      // Commits section
      const commits = events.filter((e: any) => e.type === "commit");
      if (commits.length > 0) {
        lines.push("## Commits");
        lines.push("");
        for (const c of commits) {
          const time = c.timestamp ? new Date(c.timestamp).toISOString().slice(0, 16).replace("T", " ") : "??";
          const hash = c.commit_hash ? c.commit_hash.slice(0, 7) : "???????";
          const msg = (c.content || c.summary || "").slice(0, 120).replace(/\n/g, " ");
          let author = "";
          try {
            const meta = JSON.parse(c.metadata || "{}");
            if (meta.author) author = ` (${meta.author})`;
          } catch {}
          lines.push(`- \`${hash}\` ${msg}${author} — _${time}_`);
        }
        lines.push("");
      }

      // Corrections / errors
      const corrections = events.filter((e: any) => e.type === "correction");
      const errors = events.filter((e: any) => e.type === "error");
      if (corrections.length > 0 || errors.length > 0) {
        lines.push("## Issues & Corrections");
        lines.push("");
        for (const e of [...corrections, ...errors]) {
          const icon = TYPE_ICONS[e.type] || "❓";
          const time = e.timestamp ? new Date(e.timestamp).toISOString().slice(0, 16).replace("T", " ") : "??";
          const content = (e.content || e.summary || "").slice(0, 200).replace(/\n/g, " ");
          lines.push(`- ${icon} ${content} — _${time}_`);
        }
        lines.push("");
      }

      // Detailed event log (optional)
      if (params.include_details) {
        lines.push("## Event Log");
        lines.push("");

        const days = new Map<string, any[]>();
        for (const event of events) {
          const day = event.timestamp ? new Date(event.timestamp).toISOString().slice(0, 10) : "unknown";
          if (!days.has(day)) days.set(day, []);
          days.get(day)!.push(event);
        }

        const dayKeys = [...days.keys()].sort().reverse();
        for (const day of dayKeys) {
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
            let content = (event.content || event.summary || "").slice(0, 120).replace(/\n/g, " ");

            if (event.type === "commit") {
              const hash = event.commit_hash ? event.commit_hash.slice(0, 7) + ": " : "";
              content = `commit: "${hash}${content}"`;
            } else if (event.type === "tool_call") {
              const tool = event.tool_name || "";
              const target = content ? ` → ${content}` : "";
              content = `${tool}${target}`;
            } else {
              content = `"${content}"`;
            }

            lines.push(`- ${time} ${icon} ${content}`);
          }
          lines.push("");
        }
      }

      // Footer
      lines.push("---");
      lines.push(`_Report contains ${stats.total} events. Generated by preflight export_timeline._`);

      return { content: [{ type: "text", text: lines.join("\n") }] };
    }
  );
}
