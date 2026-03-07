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

interface TypeStats {
  [type: string]: number;
}

interface DaySummary {
  date: string;
  events: any[];
  stats: TypeStats;
}

function buildDaySummaries(events: any[]): DaySummary[] {
  const days = new Map<string, any[]>();
  for (const event of events) {
    const day = event.timestamp
      ? new Date(event.timestamp).toISOString().slice(0, 10)
      : "unknown";
    if (!days.has(day)) days.set(day, []);
    days.get(day)!.push(event);
  }

  const summaries: DaySummary[] = [];
  for (const [date, dayEvents] of days) {
    dayEvents.sort((a: any, b: any) => {
      const ta = a.timestamp ? new Date(a.timestamp).getTime() : 0;
      const tb = b.timestamp ? new Date(b.timestamp).getTime() : 0;
      return ta - tb;
    });
    const stats: TypeStats = {};
    for (const e of dayEvents) {
      stats[e.type] = (stats[e.type] || 0) + 1;
    }
    summaries.push({ date, events: dayEvents, stats });
  }

  summaries.sort((a, b) => b.date.localeCompare(a.date));
  return summaries;
}

function renderMarkdownReport(
  summaries: DaySummary[],
  totalEvents: number,
  projectLabel: string,
  format: "detailed" | "summary"
): string {
  const lines: string[] = [];
  const dateRange =
    summaries.length > 1
      ? `${summaries[summaries.length - 1].date} → ${summaries[0].date}`
      : summaries[0]?.date || "N/A";

  lines.push(`# Session Report: ${projectLabel}`);
  lines.push("");
  lines.push(`**Period:** ${dateRange}  `);
  lines.push(`**Total Events:** ${totalEvents}  `);
  lines.push(`**Days Active:** ${summaries.length}`);
  lines.push("");

  // Aggregate stats
  const totals: TypeStats = {};
  for (const s of summaries) {
    for (const [type, count] of Object.entries(s.stats)) {
      totals[type] = (totals[type] || 0) + count;
    }
  }

  lines.push("## Overview");
  lines.push("");
  lines.push("| Event Type | Count |");
  lines.push("|------------|-------|");
  for (const [type, count] of Object.entries(totals).sort(
    (a, b) => b[1] - a[1]
  )) {
    lines.push(`| ${TYPE_LABELS[type] || type} | ${count} |`);
  }
  lines.push("");

  // Correction rate
  const prompts = totals["prompt"] || 0;
  const corrections = totals["correction"] || 0;
  if (prompts > 0) {
    const rate = ((corrections / prompts) * 100).toFixed(1);
    lines.push(`**Correction Rate:** ${corrections}/${prompts} prompts (${rate}%)`);
    lines.push("");
  }

  // Per-day breakdown
  for (const day of summaries) {
    lines.push(`## ${day.date}`);
    lines.push("");

    const dayStats = Object.entries(day.stats)
      .map(([t, c]) => `${TYPE_LABELS[t] || t}: ${c}`)
      .join(" · ");
    lines.push(`_${dayStats}_`);
    lines.push("");

    if (format === "detailed") {
      for (const event of day.events) {
        const time = event.timestamp
          ? new Date(event.timestamp).toISOString().slice(11, 16)
          : "??:??";
        const label = TYPE_LABELS[event.type] || event.type;
        let content = (event.content || event.summary || "")
          .slice(0, 200)
          .replace(/\n/g, " ");

        if (event.type === "commit") {
          const hash = event.commit_hash
            ? event.commit_hash.slice(0, 7)
            : "";
          lines.push(`- **${time}** [${label}] \`${hash}\` ${content}`);
        } else if (event.type === "tool_call") {
          const tool = event.tool_name || "";
          lines.push(
            `- **${time}** [${label}] \`${tool}\`${content ? ` — ${content}` : ""}`
          );
        } else {
          lines.push(`- **${time}** [${label}] ${content}`);
        }
      }
      lines.push("");
    }
  }

  // Trends section
  if (summaries.length >= 2) {
    lines.push("## Trends");
    lines.push("");

    const dailyPrompts = summaries.map((s) => ({
      date: s.date,
      prompts: s.stats["prompt"] || 0,
      corrections: s.stats["correction"] || 0,
      commits: s.stats["commit"] || 0,
    }));

    lines.push("| Date | Prompts | Corrections | Commits |");
    lines.push("|------|---------|-------------|---------|");
    for (const d of dailyPrompts) {
      lines.push(`| ${d.date} | ${d.prompts} | ${d.corrections} | ${d.commits} |`);
    }
    lines.push("");
  }

  lines.push(
    `_Generated ${new Date().toISOString().slice(0, 19).replace("T", " ")} UTC by preflight export_timeline_`
  );

  return lines.join("\n");
}

export function registerExportTimeline(server: McpServer) {
  server.tool(
    "export_timeline",
    "Generate a markdown session report from timeline data. Includes event stats, correction rates, daily breakdowns, and trends. Use for weekly summaries and prompt quality analysis.",
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
        .describe(
          'Start date — ISO string or relative like "7days", "1week", "1month"'
        ),
      until: z.string().optional().describe("End date"),
      format: z
        .enum(["detailed", "summary"])
        .default("summary")
        .describe(
          "detailed = full event listing per day; summary = stats only"
        ),
      branch: z.string().optional(),
      author: z.string().optional().describe("Filter commits by author"),
    },
    async (params) => {
      const since = params.since
        ? parseRelativeDate(params.since)
        : parseRelativeDate("7days");
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
              text: `No projects found for scope "${params.scope}". Set CLAUDE_PROJECT_DIR or onboard projects first.`,
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
        limit: 2000,
        offset: 0,
      });

      // Filter by author if specified
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
              text: "No events found for the given filters. Try a wider date range or different scope.",
            },
          ],
        };
      }

      const projectLabel =
        params.project || (params.scope === "current" ? "Current Project" : params.scope);
      const summaries = buildDaySummaries(events);
      const report = renderMarkdownReport(
        summaries,
        events.length,
        projectLabel,
        params.format
      );

      return {
        content: [{ type: "text" as const, text: report }],
      };
    }
  );
}
