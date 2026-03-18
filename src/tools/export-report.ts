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

interface EventRecord {
  timestamp: string;
  type: string;
  content?: string;
  summary?: string;
  commit_hash?: string;
  tool_name?: string;
  metadata?: string;
  session_id?: string;
  project_name?: string;
}

interface DayStats {
  prompts: number;
  commits: number;
  corrections: number;
  toolCalls: number;
  errors: number;
  total: number;
}

function computeDayStats(events: EventRecord[]): DayStats {
  const stats: DayStats = { prompts: 0, commits: 0, corrections: 0, toolCalls: 0, errors: 0, total: events.length };
  for (const e of events) {
    if (e.type === "prompt") stats.prompts++;
    else if (e.type === "commit") stats.commits++;
    else if (e.type === "correction") stats.corrections++;
    else if (e.type === "tool_call") stats.toolCalls++;
    else if (e.type === "error") stats.errors++;
  }
  return stats;
}

function renderSummarySection(allEvents: EventRecord[], days: Map<string, EventRecord[]>): string[] {
  const lines: string[] = [];
  const totalStats = computeDayStats(allEvents);
  const sessions = new Set(allEvents.map((e) => e.session_id).filter(Boolean));

  lines.push("## Summary");
  lines.push("");
  lines.push(`| Metric | Value |`);
  lines.push(`|--------|-------|`);
  lines.push(`| Total events | ${totalStats.total} |`);
  lines.push(`| Days active | ${days.size} |`);
  lines.push(`| Sessions | ${sessions.size} |`);
  lines.push(`| Prompts | ${totalStats.prompts} |`);
  lines.push(`| Commits | ${totalStats.commits} |`);
  lines.push(`| Tool calls | ${totalStats.toolCalls} |`);
  lines.push(`| Corrections | ${totalStats.corrections} |`);
  lines.push(`| Errors | ${totalStats.errors} |`);
  if (totalStats.prompts > 0) {
    const correctionRate = ((totalStats.corrections / totalStats.prompts) * 100).toFixed(1);
    lines.push(`| Correction rate | ${correctionRate}% |`);
  }
  lines.push("");

  return lines;
}

function renderDailyBreakdown(days: Map<string, EventRecord[]>): string[] {
  const lines: string[] = [];
  const sortedDays = [...days.keys()].sort().reverse();

  lines.push("## Daily Breakdown");
  lines.push("");
  lines.push("| Date | Events | Prompts | Commits | Corrections | Errors |");
  lines.push("|------|--------|---------|---------|-------------|--------|");

  for (const day of sortedDays) {
    const stats = computeDayStats(days.get(day)!);
    lines.push(
      `| ${day} | ${stats.total} | ${stats.prompts} | ${stats.commits} | ${stats.corrections} | ${stats.errors} |`
    );
  }
  lines.push("");

  return lines;
}

function renderTrends(days: Map<string, EventRecord[]>): string[] {
  const lines: string[] = [];
  const sortedDays = [...days.keys()].sort();

  if (sortedDays.length < 2) return lines;

  lines.push("## Trends");
  lines.push("");

  // Prompt quality trend (correction rate over time)
  const recentDays = sortedDays.slice(-7);
  const olderDays = sortedDays.slice(0, -7);

  if (olderDays.length > 0) {
    const recentEvents = recentDays.flatMap((d) => days.get(d) || []);
    const olderEvents = olderDays.flatMap((d) => days.get(d) || []);

    const recentPrompts = recentEvents.filter((e) => e.type === "prompt").length;
    const recentCorrections = recentEvents.filter((e) => e.type === "correction").length;
    const olderPrompts = olderEvents.filter((e) => e.type === "prompt").length;
    const olderCorrections = olderEvents.filter((e) => e.type === "correction").length;

    const recentRate = recentPrompts > 0 ? (recentCorrections / recentPrompts) * 100 : 0;
    const olderRate = olderPrompts > 0 ? (olderCorrections / olderPrompts) * 100 : 0;

    lines.push(`- **Correction rate (last 7 days):** ${recentRate.toFixed(1)}%`);
    lines.push(`- **Correction rate (prior):** ${olderRate.toFixed(1)}%`);

    if (recentRate < olderRate) {
      lines.push(`- 📈 Prompt quality is **improving** (fewer corrections needed)`);
    } else if (recentRate > olderRate) {
      lines.push(`- 📉 Prompt quality is **declining** (more corrections needed)`);
    } else {
      lines.push(`- ➡️ Prompt quality is **stable**`);
    }
  }

  // Activity trend
  const avgEventsPerDay = sortedDays.reduce((sum, d) => sum + (days.get(d)?.length || 0), 0) / sortedDays.length;
  lines.push(`- **Average events/day:** ${avgEventsPerDay.toFixed(1)}`);
  lines.push("");

  return lines;
}

function renderCommitLog(events: EventRecord[]): string[] {
  const commits = events.filter((e) => e.type === "commit");
  if (commits.length === 0) return [];

  const lines: string[] = [];
  lines.push("## Commit Log");
  lines.push("");

  for (const c of commits) {
    const hash = c.commit_hash ? c.commit_hash.slice(0, 7) : "???????";
    const msg = (c.content || c.summary || "").slice(0, 120).replace(/\n/g, " ");
    const time = c.timestamp ? new Date(c.timestamp).toISOString().slice(0, 16).replace("T", " ") : "unknown";
    lines.push(`- \`${hash}\` ${msg} _(${time})_`);
  }
  lines.push("");

  return lines;
}

function renderCorrections(events: EventRecord[]): string[] {
  const corrections = events.filter((e) => e.type === "correction");
  if (corrections.length === 0) return [];

  const lines: string[] = [];
  lines.push("## Corrections");
  lines.push("");

  for (const c of corrections) {
    const msg = (c.content || c.summary || "").slice(0, 200).replace(/\n/g, " ");
    const time = c.timestamp ? new Date(c.timestamp).toISOString().slice(0, 16).replace("T", " ") : "unknown";
    lines.push(`- _(${time})_ ${msg}`);
  }
  lines.push("");

  return lines;
}

export function registerExportReport(server: McpServer) {
  server.tool(
    "export_report",
    "Generate a markdown report from timeline data. Includes summary statistics, daily breakdown, prompt quality trends, commit log, and corrections. Useful for weekly reviews and team standups.",
    {
      scope: z
        .enum(["current", "related", "all"])
        .default("current")
        .describe("Search scope: current project, related projects, or all indexed"),
      project: z.string().optional().describe("Filter to a specific project (overrides scope)"),
      since: z
        .string()
        .optional()
        .describe('Start date (ISO or relative like "7days", "1week", "1month")'),
      until: z.string().optional().describe("End date (ISO or relative)"),
      sections: z
        .array(z.enum(["summary", "daily", "trends", "commits", "corrections"]))
        .default(["summary", "daily", "trends", "commits", "corrections"])
        .describe("Which sections to include"),
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
          content: [
            {
              type: "text" as const,
              text: `# Report\n\n_No projects found for scope "${params.scope}". Make sure CLAUDE_PROJECT_DIR is set or projects are onboarded._`,
            },
          ],
        };
      }

      // Fetch all events (high limit for reports)
      const events: EventRecord[] = await getTimeline({
        project_dirs: projectDirs,
        project: undefined,
        since,
        until,
        limit: 5000,
        offset: 0,
      });

      if (events.length === 0) {
        return {
          content: [
            {
              type: "text" as const,
              text: "# Report\n\n_No events found for the given filters._",
            },
          ],
        };
      }

      // Group by day
      const days = new Map<string, EventRecord[]>();
      for (const event of events) {
        const day = event.timestamp
          ? new Date(event.timestamp).toISOString().slice(0, 10)
          : "unknown";
        if (!days.has(day)) days.set(day, []);
        days.get(day)!.push(event);
      }

      // Build report
      const sortedDays = [...days.keys()].sort();
      const dateRange =
        sortedDays.length > 1
          ? `${sortedDays[0]} → ${sortedDays[sortedDays.length - 1]}`
          : sortedDays[0];

      const proj = params.project || params.scope;
      const title = params.title || `Session Report: ${proj}`;

      const lines: string[] = [
        `# ${title}`,
        "",
        `_${dateRange} · ${events.length} events · Generated ${new Date().toISOString().slice(0, 16)}_`,
        "",
      ];

      const sectionRenderers: Record<string, () => string[]> = {
        summary: () => renderSummarySection(events, days),
        daily: () => renderDailyBreakdown(days),
        trends: () => renderTrends(days),
        commits: () => renderCommitLog(events),
        corrections: () => renderCorrections(events),
      };

      for (const section of params.sections) {
        const renderer = sectionRenderers[section];
        if (renderer) {
          lines.push(...renderer());
        }
      }

      lines.push("---");
      lines.push("_Generated by preflight `export_report`_");

      return {
        content: [{ type: "text" as const, text: lines.join("\n") }],
      };
    }
  );
}
