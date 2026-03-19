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

interface TimelineEvent {
  timestamp?: string;
  type: string;
  content?: string;
  summary?: string;
  commit_hash?: string;
  tool_name?: string;
  metadata?: string;
  project?: string;
}

function computeStats(events: TimelineEvent[]) {
  const byType: Record<string, number> = {};
  const byDay: Record<string, number> = {};
  let totalPromptChars = 0;
  let promptCount = 0;

  for (const e of events) {
    byType[e.type] = (byType[e.type] || 0) + 1;
    if (e.timestamp) {
      const day = new Date(e.timestamp).toISOString().slice(0, 10);
      byDay[day] = (byDay[day] || 0) + 1;
    }
    if (e.type === "prompt" && e.content) {
      totalPromptChars += e.content.length;
      promptCount++;
    }
  }

  return { byType, byDay, avgPromptLen: promptCount > 0 ? Math.round(totalPromptChars / promptCount) : 0, promptCount };
}

function generateMarkdownReport(
  events: TimelineEvent[],
  opts: { project: string; since?: string; until?: string; title?: string }
): string {
  const stats = computeStats(events);
  const sortedDays = Object.keys(stats.byDay).sort().reverse();
  const dateRange =
    sortedDays.length > 1
      ? `${sortedDays[sortedDays.length - 1]} → ${sortedDays[0]}`
      : sortedDays[0] || "no events";

  const lines: string[] = [];

  // Title
  lines.push(`# ${opts.title || `Session Report: ${opts.project}`}`);
  lines.push("");
  lines.push(`**Period:** ${dateRange}  `);
  lines.push(`**Total events:** ${events.length}  `);
  lines.push(`**Generated:** ${new Date().toISOString().slice(0, 16)}Z`);
  lines.push("");

  // Summary stats
  lines.push("## Summary");
  lines.push("");
  lines.push("| Metric | Value |");
  lines.push("|--------|-------|");
  for (const [type, count] of Object.entries(stats.byType).sort((a, b) => b[1] - a[1])) {
    const icon = TYPE_ICONS[type] || "❓";
    lines.push(`| ${icon} ${type} | ${count} |`);
  }
  if (stats.promptCount > 0) {
    lines.push(`| Avg prompt length | ${stats.avgPromptLen} chars |`);
  }
  lines.push("");

  // Activity by day
  lines.push("## Daily Activity");
  lines.push("");
  for (const day of sortedDays) {
    const count = stats.byDay[day];
    const bar = "█".repeat(Math.min(count, 40));
    lines.push(`- **${day}** ${bar} ${count}`);
  }
  lines.push("");

  // Error/correction highlights
  const issues = events.filter((e) => e.type === "error" || e.type === "correction");
  if (issues.length > 0) {
    lines.push("## Issues & Corrections");
    lines.push("");
    for (const e of issues) {
      const time = e.timestamp ? new Date(e.timestamp).toISOString().slice(0, 16) : "??";
      const icon = TYPE_ICONS[e.type] || "❓";
      const content = (e.content || e.summary || "").slice(0, 200).replace(/\n/g, " ");
      lines.push(`- ${icon} **${time}** — ${content}`);
    }
    lines.push("");
  }

  // Commits
  const commits = events.filter((e) => e.type === "commit");
  if (commits.length > 0) {
    lines.push("## Commits");
    lines.push("");
    for (const e of commits) {
      const time = e.timestamp ? new Date(e.timestamp).toISOString().slice(0, 16) : "??";
      const hash = e.commit_hash ? e.commit_hash.slice(0, 7) : "";
      const msg = (e.content || e.summary || "").slice(0, 120).replace(/\n/g, " ");
      lines.push(`- \`${hash}\` ${msg} _(${time})_`);
    }
    lines.push("");
  }

  // Tool usage breakdown
  const toolCalls = events.filter((e) => e.type === "tool_call");
  if (toolCalls.length > 0) {
    const toolCounts: Record<string, number> = {};
    for (const e of toolCalls) {
      const name = e.tool_name || "unknown";
      toolCounts[name] = (toolCounts[name] || 0) + 1;
    }
    lines.push("## Tool Usage");
    lines.push("");
    lines.push("| Tool | Calls |");
    lines.push("|------|-------|");
    for (const [name, count] of Object.entries(toolCounts).sort((a, b) => b[1] - a[1])) {
      lines.push(`| ${name} | ${count} |`);
    }
    lines.push("");
  }

  // Detailed timeline (last 30 events)
  const recent = events.slice(-30);
  lines.push("## Recent Activity (last 30 events)");
  lines.push("");
  for (const e of recent) {
    const time = e.timestamp ? new Date(e.timestamp).toISOString().slice(11, 16) : "??:??";
    const day = e.timestamp ? new Date(e.timestamp).toISOString().slice(0, 10) : "";
    const icon = TYPE_ICONS[e.type] || "❓";
    const content = (e.content || e.summary || "").slice(0, 100).replace(/\n/g, " ");
    lines.push(`- ${day} ${time} ${icon} ${content}`);
  }
  lines.push("");

  return lines.join("\n");
}

export function registerExportTimeline(server: McpServer) {
  server.tool(
    "export_timeline",
    "Export timeline data as a structured markdown report with summary statistics, daily activity, commits, tool usage, and issue highlights. Use for weekly summaries, session reviews, and team reports.",
    {
      scope: z
        .enum(["current", "related", "all"])
        .default("current")
        .describe("Search scope: current project, related projects, or all indexed"),
      project: z.string().optional().describe("Filter to a specific project (overrides scope)"),
      since: z
        .string()
        .optional()
        .describe('Start date (ISO or relative like "7days", "2weeks", "1month")'),
      until: z.string().optional().describe("End date (ISO or relative)"),
      title: z.string().optional().describe("Custom report title"),
      branch: z.string().optional().describe("Filter to branch"),
      author: z.string().optional().describe("Filter commits to author (partial match)"),
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
              type: "text" as const,
              text: `No projects found for scope "${params.scope}". Make sure CLAUDE_PROJECT_DIR is set or projects are onboarded.`,
            },
          ],
        };
      }

      let events = await getTimeline({
        project_dirs: projectDirs,
        project: undefined,
        branch: params.branch,
        since,
        until,
        type: undefined,
        limit: params.limit,
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
          } catch {
            return true;
          }
        });
      }

      if (events.length === 0) {
        return {
          content: [{ type: "text" as const, text: "No events found for the given filters. Nothing to export." }],
        };
      }

      const projectName = params.project || projectDirs[0] || "all projects";
      const report = generateMarkdownReport(events, {
        project: projectName,
        since,
        until,
        title: params.title,
      });

      return {
        content: [{ type: "text" as const, text: report }],
      };
    }
  );
}
