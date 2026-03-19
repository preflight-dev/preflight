import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getTimeline, listIndexedProjects } from "../lib/timeline-db.js";
import { getRelatedProjects } from "../lib/config.js";
import type { SearchScope } from "../types.js";

const RELATIVE_DATE_RE = /^(\d+)(days?|weeks?|months?|years?)$/;

export function parseRelativeDate(input: string): string {
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

interface TimelineEvent {
  timestamp?: string;
  type: string;
  content?: string;
  summary?: string;
  commit_hash?: string;
  tool_name?: string;
  metadata?: string;
}

interface ReportStats {
  total: number;
  byType: Record<string, number>;
  byDay: Map<string, TimelineEvent[]>;
  promptCount: number;
  commitCount: number;
  errorCount: number;
  correctionCount: number;
  toolCallCount: number;
}

export function computeStats(events: TimelineEvent[]): ReportStats {
  const byType: Record<string, number> = {};
  const byDay = new Map<string, TimelineEvent[]>();

  for (const e of events) {
    byType[e.type] = (byType[e.type] || 0) + 1;
    const day = e.timestamp
      ? new Date(e.timestamp).toISOString().slice(0, 10)
      : "unknown";
    if (!byDay.has(day)) byDay.set(day, []);
    byDay.get(day)!.push(e);
  }

  return {
    total: events.length,
    byType,
    byDay,
    promptCount: byType["prompt"] || 0,
    commitCount: byType["commit"] || 0,
    errorCount: byType["error"] || 0,
    correctionCount: byType["correction"] || 0,
    toolCallCount: byType["tool_call"] || 0,
  };
}

export function generateMarkdownReport(
  events: TimelineEvent[],
  stats: ReportStats,
  options: { title: string; since?: string; until?: string; sections: string[] }
): string {
  const lines: string[] = [];
  const now = new Date().toISOString().slice(0, 10);

  lines.push(`# ${options.title}`);
  lines.push(`_Generated ${now}_`);
  if (options.since || options.until) {
    const range = [options.since || "beginning", options.until || "now"].join(
      " → "
    );
    lines.push(`_Period: ${range}_`);
  }
  lines.push("");

  // Summary section
  if (options.sections.includes("summary")) {
    lines.push("## Summary");
    lines.push("");
    lines.push(`| Metric | Count |`);
    lines.push(`|--------|-------|`);
    lines.push(`| Total events | ${stats.total} |`);
    lines.push(`| Prompts | ${stats.promptCount} |`);
    lines.push(`| Commits | ${stats.commitCount} |`);
    lines.push(`| Tool calls | ${stats.toolCallCount} |`);
    lines.push(`| Corrections | ${stats.correctionCount} |`);
    lines.push(`| Errors | ${stats.errorCount} |`);
    lines.push("");

    if (stats.total > 0) {
      const correctionRate =
        stats.promptCount > 0
          ? ((stats.correctionCount / stats.promptCount) * 100).toFixed(1)
          : "N/A";
      const errorRate = ((stats.errorCount / stats.total) * 100).toFixed(1);
      lines.push(
        `**Correction rate:** ${correctionRate === "N/A" ? correctionRate : correctionRate + "%"} of prompts`
      );
      lines.push(`**Error rate:** ${errorRate}% of events`);
      lines.push("");
    }
  }

  // Activity breakdown
  if (options.sections.includes("activity")) {
    lines.push("## Daily Activity");
    lines.push("");
    const sortedDays = [...stats.byDay.keys()].sort().reverse();
    for (const day of sortedDays) {
      const dayEvents = stats.byDay.get(day)!;
      const dayCounts: Record<string, number> = {};
      for (const e of dayEvents) {
        dayCounts[e.type] = (dayCounts[e.type] || 0) + 1;
      }
      const parts = Object.entries(dayCounts)
        .map(([t, c]) => `${TYPE_ICONS[t] || "❓"} ${t}: ${c}`)
        .join(", ");
      lines.push(`- **${day}** (${dayEvents.length} events) — ${parts}`);
    }
    lines.push("");
  }

  // Commits section
  if (options.sections.includes("commits")) {
    const commits = events.filter((e) => e.type === "commit");
    if (commits.length > 0) {
      lines.push("## Commits");
      lines.push("");
      for (const c of commits) {
        const hash = c.commit_hash ? c.commit_hash.slice(0, 7) : "???????";
        const msg = (c.content || c.summary || "").slice(0, 120).replace(/\n/g, " ");
        const time = c.timestamp
          ? new Date(c.timestamp).toISOString().slice(0, 16).replace("T", " ")
          : "";
        lines.push(`- \`${hash}\` ${msg} _(${time})_`);
      }
      lines.push("");
    }
  }

  // Corrections section
  if (options.sections.includes("corrections")) {
    const corrections = events.filter((e) => e.type === "correction");
    if (corrections.length > 0) {
      lines.push("## Corrections");
      lines.push("");
      lines.push(
        "_Patterns in corrections can reveal prompt quality issues._"
      );
      lines.push("");
      for (const c of corrections) {
        const msg = (c.content || c.summary || "").slice(0, 200).replace(/\n/g, " ");
        lines.push(`- ${msg}`);
      }
      lines.push("");
    }
  }

  // Errors section
  if (options.sections.includes("errors")) {
    const errors = events.filter((e) => e.type === "error");
    if (errors.length > 0) {
      lines.push("## Errors");
      lines.push("");
      for (const e of errors) {
        const msg = (e.content || e.summary || "").slice(0, 200).replace(/\n/g, " ");
        lines.push(`- ⚠️ ${msg}`);
      }
      lines.push("");
    }
  }

  // Timeline section
  if (options.sections.includes("timeline")) {
    lines.push("## Full Timeline");
    lines.push("");
    const sortedDays = [...stats.byDay.keys()].sort().reverse();
    for (const day of sortedDays) {
      lines.push(`### ${day}`);
      const dayEvents = stats.byDay.get(day)!;
      dayEvents.sort((a, b) => {
        const ta = a.timestamp ? new Date(a.timestamp).getTime() : 0;
        const tb = b.timestamp ? new Date(b.timestamp).getTime() : 0;
        return ta - tb;
      });
      for (const event of dayEvents) {
        const time = event.timestamp
          ? new Date(event.timestamp).toISOString().slice(11, 16)
          : "??:??";
        const icon = TYPE_ICONS[event.type] || "❓";
        const content = (event.content || event.summary || "")
          .slice(0, 120)
          .replace(/\n/g, " ");
        lines.push(`- ${time} ${icon} ${content}`);
      }
      lines.push("");
    }
  }

  return lines.join("\n");
}

export function registerExportTimeline(server: McpServer) {
  server.tool(
    "export_timeline",
    "Generate a markdown report from timeline data. Produces session summaries with stats, commit logs, correction patterns, and daily activity breakdowns.",
    {
      scope: z
        .enum(["current", "related", "all"])
        .default("current")
        .describe("Search scope"),
      project: z.string().optional().describe("Specific project (overrides scope)"),
      since: z
        .string()
        .optional()
        .describe("Start date (ISO or relative like '7days', '2weeks')"),
      until: z.string().optional().describe("End date"),
      title: z
        .string()
        .default("Session Report")
        .describe("Report title"),
      sections: z
        .array(
          z.enum([
            "summary",
            "activity",
            "commits",
            "corrections",
            "errors",
            "timeline",
          ])
        )
        .default(["summary", "activity", "commits", "corrections", "errors"])
        .describe("Which sections to include"),
      limit: z.number().default(500).describe("Max events to include"),
    },
    async (params) => {
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
              type: "text",
              text: `No projects found for scope "${params.scope}". Make sure CLAUDE_PROJECT_DIR is set or projects are onboarded.`,
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
              text: "No events found for the given filters. Nothing to report.",
            },
          ],
        };
      }

      const stats = computeStats(events);
      const report = generateMarkdownReport(events, stats, {
        title: params.title,
        since: params.since,
        until: params.until,
        sections: params.sections,
      });

      return {
        content: [{ type: "text", text: report }],
      };
    }
  );
}
