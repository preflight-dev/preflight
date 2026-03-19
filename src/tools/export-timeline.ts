// =============================================================================
// export_timeline — Generate markdown reports from timeline data
// Weekly summaries, prompt quality trends, activity breakdowns
// Closes #5
// =============================================================================

import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getTimeline, listIndexedProjects } from "../lib/timeline-db.js";
import { getRelatedProjects } from "../lib/config.js";
import type { SearchScope } from "../types.js";
import type { TimelineEvent } from "../lib/timeline-db.js";
import { writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { homedir } from "os";

// ── Helpers ─────────────────────────────────────────────────────────────────

const REPORTS_DIR = join(homedir(), ".preflight", "reports");

const TYPE_LABELS: Record<string, string> = {
  prompt: "Prompts",
  assistant: "Responses",
  tool_call: "Tool Calls",
  correction: "Corrections",
  commit: "Commits",
  compaction: "Compactions",
  sub_agent_spawn: "Sub-agent Spawns",
  error: "Errors",
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

function getDateRange(
  period: "day" | "week" | "month",
  offset: number = 0
): { since: string; until: string; label: string } {
  const now = new Date();
  let start: Date;
  let end: Date;

  if (period === "day") {
    start = new Date(now);
    start.setDate(start.getDate() - offset);
    start.setHours(0, 0, 0, 0);
    end = new Date(start);
    end.setDate(end.getDate() + 1);
    const label = start.toISOString().slice(0, 10);
    return { since: start.toISOString(), until: end.toISOString(), label };
  }

  if (period === "week") {
    // Start of current week (Monday) minus offset weeks
    start = new Date(now);
    const dayOfWeek = start.getDay();
    const diff = dayOfWeek === 0 ? 6 : dayOfWeek - 1; // Monday = 0
    start.setDate(start.getDate() - diff - offset * 7);
    start.setHours(0, 0, 0, 0);
    end = new Date(start);
    end.setDate(end.getDate() + 7);
    const label = `Week of ${start.toISOString().slice(0, 10)}`;
    return { since: start.toISOString(), until: end.toISOString(), label };
  }

  // month
  start = new Date(now.getFullYear(), now.getMonth() - offset, 1);
  end = new Date(now.getFullYear(), now.getMonth() - offset + 1, 1);
  const monthNames = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
  ];
  const label = `${monthNames[start.getMonth()]} ${start.getFullYear()}`;
  return { since: start.toISOString(), until: end.toISOString(), label };
}

interface DayStats {
  total: number;
  byType: Record<string, number>;
  events: TimelineEvent[];
}

function groupByDay(events: TimelineEvent[]): Map<string, DayStats> {
  const days = new Map<string, DayStats>();
  for (const e of events) {
    const day = e.timestamp
      ? new Date(e.timestamp).toISOString().slice(0, 10)
      : "unknown";
    if (!days.has(day)) {
      days.set(day, { total: 0, byType: {}, events: [] });
    }
    const stats = days.get(day)!;
    stats.total++;
    stats.byType[e.type] = (stats.byType[e.type] || 0) + 1;
    stats.events.push(e);
  }
  return days;
}

function buildActivityChart(days: Map<string, DayStats>, sortedDays: string[]): string {
  if (sortedDays.length === 0) return "";
  const maxEvents = Math.max(...sortedDays.map((d) => days.get(d)!.total));
  const barWidth = 20;
  const lines: string[] = ["### Activity Chart", "```"];
  for (const day of sortedDays) {
    const count = days.get(day)!.total;
    const bar = "█".repeat(Math.round((count / maxEvents) * barWidth));
    lines.push(`${day} ${bar} ${count}`);
  }
  lines.push("```", "");
  return lines.join("\n");
}

function buildSummaryStats(events: TimelineEvent[]): string {
  const byType: Record<string, number> = {};
  for (const e of events) {
    byType[e.type] = (byType[e.type] || 0) + 1;
  }

  const lines: string[] = ["### Summary", ""];
  lines.push(`| Metric | Count |`);
  lines.push(`|--------|-------|`);
  lines.push(`| **Total Events** | ${events.length} |`);

  for (const [type, count] of Object.entries(byType).sort((a, b) => b[1] - a[1])) {
    const icon = TYPE_ICONS[type] || "❓";
    const label = TYPE_LABELS[type] || type;
    lines.push(`| ${icon} ${label} | ${count} |`);
  }

  // Correction rate
  const prompts = byType["prompt"] || 0;
  const corrections = byType["correction"] || 0;
  if (prompts > 0) {
    const rate = ((corrections / prompts) * 100).toFixed(1);
    lines.push(`| 📊 Correction Rate | ${rate}% |`);
  }

  // Commits per prompt
  const commits = byType["commit"] || 0;
  if (prompts > 0) {
    const ratio = (commits / prompts).toFixed(2);
    lines.push(`| 📊 Commits/Prompt | ${ratio} |`);
  }

  lines.push("");
  return lines.join("\n");
}

function buildTopCommits(events: TimelineEvent[], limit: number = 10): string {
  const commits = events
    .filter((e) => e.type === "commit")
    .slice(0, limit);

  if (commits.length === 0) return "";

  const lines: string[] = ["### Recent Commits", ""];
  for (const c of commits) {
    const time = c.timestamp
      ? new Date(c.timestamp).toISOString().slice(0, 16).replace("T", " ")
      : "??";
    const msg = (c.content || "").slice(0, 100).replace(/\n/g, " ");
    lines.push(`- \`${time}\` ${msg}`);
  }
  lines.push("");
  return lines.join("\n");
}

function buildCorrectionInsights(events: TimelineEvent[]): string {
  const corrections = events.filter((e) => e.type === "correction");
  if (corrections.length === 0) return "";

  const lines: string[] = ["### Corrections & Lessons", ""];
  for (const c of corrections.slice(0, 10)) {
    const content = (c.content || "").slice(0, 150).replace(/\n/g, " ");
    lines.push(`- ❌ ${content}`);
  }
  lines.push("");
  return lines.join("\n");
}

function buildErrorSummary(events: TimelineEvent[]): string {
  const errors = events.filter((e) => e.type === "error");
  if (errors.length === 0) return "";

  const lines: string[] = ["### Errors", ""];
  for (const e of errors.slice(0, 10)) {
    const content = (e.content || "").slice(0, 150).replace(/\n/g, " ");
    lines.push(`- ⚠️ ${content}`);
  }
  lines.push("");
  return lines.join("\n");
}

// ── Main Export ─────────────────────────────────────────────────────────────

export function registerExportTimeline(server: McpServer) {
  server.tool(
    "export_timeline",
    "Generate a markdown report from timeline data. Produces session summaries with activity charts, commit logs, correction insights, and key metrics. Optionally saves to ~/.preflight/reports/.",
    {
      scope: z
        .enum(["current", "related", "all"])
        .default("current")
        .describe("Search scope: current project, related, or all indexed"),
      project: z
        .string()
        .optional()
        .describe("Filter to specific project (overrides scope)"),
      period: z
        .enum(["day", "week", "month"])
        .default("week")
        .describe("Report period"),
      offset: z
        .number()
        .default(0)
        .describe("Period offset (0 = current, 1 = previous, etc.)"),
      save: z
        .boolean()
        .default(false)
        .describe("Save report to ~/.preflight/reports/"),
      include_commits: z.boolean().default(true).describe("Include commit log"),
      include_corrections: z
        .boolean()
        .default(true)
        .describe("Include correction insights"),
      include_errors: z.boolean().default(true).describe("Include error summary"),
      include_chart: z.boolean().default(true).describe("Include activity chart"),
    },
    async (params) => {
      const { since, until, label } = getDateRange(params.period, params.offset);

      // Resolve projects
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
              text: `No projects found for scope "${params.scope}". Set CLAUDE_PROJECT_DIR or onboard projects first.`,
            },
          ],
        };
      }

      // Fetch all events for the period (large limit for reports)
      const events = await getTimeline({
        project_dirs: projectDirs,
        since,
        until,
        limit: 5000,
        offset: 0,
      });

      if (events.length === 0) {
        return {
          content: [
            {
              type: "text",
              text: `## Report: ${label}\n\n_No events found for this period._`,
            },
          ],
        };
      }

      // Build report
      const projName = params.project || params.scope;
      const days = groupByDay(events);
      const sortedDays = [...days.keys()].sort();

      const sections: string[] = [
        `# 📊 Session Report: ${label}`,
        `**Scope:** ${projName} | **Period:** ${since.slice(0, 10)} → ${until.slice(0, 10)} | **Events:** ${events.length}`,
        "",
        buildSummaryStats(events),
      ];

      if (params.include_chart) {
        sections.push(buildActivityChart(days, sortedDays));
      }

      if (params.include_commits) {
        sections.push(buildTopCommits(events));
      }

      if (params.include_corrections) {
        sections.push(buildCorrectionInsights(events));
      }

      if (params.include_errors) {
        sections.push(buildErrorSummary(events));
      }

      // Footer
      sections.push(
        "---",
        `_Generated by preflight export_timeline on ${new Date().toISOString().slice(0, 16)}_`
      );

      const report = sections.filter(Boolean).join("\n");

      // Optionally save
      let savedPath: string | undefined;
      if (params.save) {
        mkdirSync(REPORTS_DIR, { recursive: true });
        const filename = `report-${params.period}-${since.slice(0, 10)}.md`;
        savedPath = join(REPORTS_DIR, filename);
        writeFileSync(savedPath, report, "utf-8");
      }

      const footer = savedPath ? `\n\n_Saved to \`${savedPath}\`_` : "";

      return {
        content: [{ type: "text", text: report + footer }],
      };
    }
  );
}
