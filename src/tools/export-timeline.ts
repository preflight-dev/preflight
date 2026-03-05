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
  errorCount: number;
  correctionCount: number;
  commitCount: number;
  promptCount: number;
  toolCallCount: number;
}

function computeStats(events: any[]): EventStats {
  const stats: EventStats = {
    total: events.length,
    byType: {},
    byDay: {},
    errorCount: 0,
    correctionCount: 0,
    commitCount: 0,
    promptCount: 0,
    toolCallCount: 0,
  };

  for (const e of events) {
    stats.byType[e.type] = (stats.byType[e.type] || 0) + 1;
    const day = e.timestamp ? new Date(e.timestamp).toISOString().slice(0, 10) : "unknown";
    stats.byDay[day] = (stats.byDay[day] || 0) + 1;
    if (e.type === "error") stats.errorCount++;
    if (e.type === "correction") stats.correctionCount++;
    if (e.type === "commit") stats.commitCount++;
    if (e.type === "prompt") stats.promptCount++;
    if (e.type === "tool_call") stats.toolCallCount++;
  }

  return stats;
}

function formatSummaryReport(events: any[], period: string, projectLabel: string): string {
  const stats = computeStats(events);
  const sortedDays = Object.keys(stats.byDay).sort();
  const dateRange = sortedDays.length > 1
    ? `${sortedDays[0]} → ${sortedDays[sortedDays.length - 1]}`
    : sortedDays[0] || "no data";

  const lines: string[] = [
    `# Session Report: ${projectLabel}`,
    `**Period:** ${period} (${dateRange})  `,
    `**Generated:** ${new Date().toISOString().slice(0, 16)}`,
    "",
    "## Summary",
    "",
    `| Metric | Count |`,
    `|--------|-------|`,
    `| Total events | ${stats.total} |`,
    `| Prompts | ${stats.promptCount} |`,
    `| Tool calls | ${stats.toolCallCount} |`,
    `| Commits | ${stats.commitCount} |`,
    `| Corrections | ${stats.correctionCount} |`,
    `| Errors | ${stats.errorCount} |`,
    "",
  ];

  // Activity by day
  if (sortedDays.length > 1) {
    lines.push("## Daily Activity", "");
    lines.push("| Date | Events |");
    lines.push("|------|--------|");
    for (const day of sortedDays) {
      const bar = "█".repeat(Math.min(Math.ceil(stats.byDay[day] / 5), 20));
      lines.push(`| ${day} | ${stats.byDay[day]} ${bar} |`);
    }
    lines.push("");
  }

  // Event breakdown
  lines.push("## Event Breakdown", "");
  const typeEntries = Object.entries(stats.byType).sort((a, b) => b[1] - a[1]);
  for (const [type, count] of typeEntries) {
    const icon = TYPE_ICONS[type] || "❓";
    const pct = ((count / stats.total) * 100).toFixed(1);
    lines.push(`- ${icon} **${type}**: ${count} (${pct}%)`);
  }
  lines.push("");

  // Quality signals
  if (stats.correctionCount > 0 || stats.errorCount > 0) {
    lines.push("## Quality Signals", "");
    if (stats.correctionCount > 0) {
      const corrRate = ((stats.correctionCount / stats.promptCount) * 100).toFixed(1);
      lines.push(`- **Correction rate:** ${corrRate}% (${stats.correctionCount} corrections / ${stats.promptCount} prompts)`);
    }
    if (stats.errorCount > 0) {
      lines.push(`- **Errors:** ${stats.errorCount} errors encountered`);
    }
    lines.push("");
  }

  // Recent commits
  const commits = events.filter(e => e.type === "commit").slice(-10);
  if (commits.length > 0) {
    lines.push("## Recent Commits", "");
    for (const c of commits) {
      const hash = c.commit_hash ? c.commit_hash.slice(0, 7) : "???????";
      const msg = (c.content || c.summary || "").slice(0, 100).replace(/\n/g, " ");
      const time = c.timestamp ? new Date(c.timestamp).toISOString().slice(0, 16) : "unknown";
      lines.push(`- \`${hash}\` ${msg} _(${time})_`);
    }
    lines.push("");
  }

  // Top tool calls
  const toolCalls = events.filter(e => e.type === "tool_call");
  if (toolCalls.length > 0) {
    const toolFreq: Record<string, number> = {};
    for (const tc of toolCalls) {
      const name = tc.tool_name || "unknown";
      toolFreq[name] = (toolFreq[name] || 0) + 1;
    }
    const topTools = Object.entries(toolFreq).sort((a, b) => b[1] - a[1]).slice(0, 10);
    lines.push("## Most Used Tools", "");
    for (const [name, count] of topTools) {
      lines.push(`- **${name}**: ${count} calls`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

function formatDetailedReport(events: any[], period: string, projectLabel: string): string {
  const summary = formatSummaryReport(events, period, projectLabel);

  // Group by day, add full event listing
  const days = new Map<string, any[]>();
  for (const event of events) {
    const day = event.timestamp ? new Date(event.timestamp).toISOString().slice(0, 10) : "unknown";
    if (!days.has(day)) days.set(day, []);
    days.get(day)!.push(event);
  }

  const lines: string[] = [summary, "---", "", "## Detailed Timeline", ""];
  const sortedDays = [...days.keys()].sort().reverse();

  for (const day of sortedDays) {
    lines.push(`### ${day}`, "");
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
      const content = (event.content || event.summary || "").slice(0, 200).replace(/\n/g, " ");
      lines.push(`- **${time}** ${icon} \`${event.type}\` — ${content}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

export function registerExportTimeline(server: McpServer) {
  server.tool(
    "export_timeline",
    "Export session timeline data as a structured markdown report. Generates weekly summaries, prompt quality trends, activity stats, and commit logs.",
    {
      scope: z.enum(["current", "related", "all"]).default("current").describe("Search scope"),
      project: z.string().optional().describe("Filter to a specific project (overrides scope)"),
      period: z.enum(["day", "week", "month", "quarter"]).default("week").describe("Report period"),
      format: z.enum(["summary", "detailed"]).default("summary").describe("Report format: summary (stats + highlights) or detailed (full timeline)"),
      branch: z.string().optional(),
      author: z.string().optional().describe("Filter commits to this author"),
    },
    async (params) => {
      // Calculate date range from period
      const now = new Date();
      const since = new Date(now);
      switch (params.period) {
        case "day": since.setDate(since.getDate() - 1); break;
        case "week": since.setDate(since.getDate() - 7); break;
        case "month": since.setMonth(since.getMonth() - 1); break;
        case "quarter": since.setMonth(since.getMonth() - 3); break;
      }

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
            text: `# Export Timeline Report\n\n_No projects found for scope "${params.scope}". Set CLAUDE_PROJECT_DIR or onboard a project first._`,
          }],
        };
      }

      let events = await getTimeline({
        project_dirs: projectDirs,
        since: since.toISOString(),
        until: now.toISOString(),
        limit: 1000,
        offset: 0,
      });

      // Post-filter by author
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
            text: `# Export Timeline Report\n\n_No events found for the past ${params.period}._`,
          }],
        };
      }

      const projectLabel = params.project || params.scope;
      const report = params.format === "detailed"
        ? formatDetailedReport(events, params.period, projectLabel)
        : formatSummaryReport(events, params.period, projectLabel);

      return {
        content: [{ type: "text", text: report }],
      };
    }
  );
}
