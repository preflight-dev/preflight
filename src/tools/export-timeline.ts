// =============================================================================
// export_timeline — Generate markdown session reports from timeline data
// Addresses GitHub issue #5: Export timeline to markdown/PDF reports
// =============================================================================

import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getTimeline, listIndexedProjects } from "../lib/timeline-db.js";
import { getRelatedProjects } from "../lib/config.js";
import { writeFile, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import type { SearchScope } from "../types.js";

// ── Helpers ────────────────────────────────────────────────────────────────

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

// ── Stats computation ──────────────────────────────────────────────────────

interface ReportStats {
  totalEvents: number;
  prompts: number;
  corrections: number;
  commits: number;
  toolCalls: number;
  errors: number;
  compactions: number;
  subAgentSpawns: number;
  correctionRate: string;
  topTools: [string, number][];
  activeDays: number;
  avgEventsPerDay: string;
}

function computeStats(events: any[]): ReportStats {
  const counts = { prompts: 0, corrections: 0, commits: 0, toolCalls: 0, errors: 0, compactions: 0, subAgentSpawns: 0 };
  const toolNames = new Map<string, number>();
  const days = new Set<string>();

  for (const e of events) {
    if (e.timestamp) days.add(new Date(e.timestamp).toISOString().slice(0, 10));
    switch (e.type) {
      case "prompt": counts.prompts++; break;
      case "correction": counts.corrections++; break;
      case "commit": counts.commits++; break;
      case "tool_call":
        counts.toolCalls++;
        if (e.tool_name) toolNames.set(e.tool_name, (toolNames.get(e.tool_name) || 0) + 1);
        break;
      case "error": counts.errors++; break;
      case "compaction": counts.compactions++; break;
      case "sub_agent_spawn": counts.subAgentSpawns++; break;
    }
  }

  const topTools = [...toolNames.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
  const activeDays = days.size || 1;

  return {
    totalEvents: events.length,
    ...counts,
    correctionRate: counts.prompts > 0 ? ((counts.corrections / counts.prompts) * 100).toFixed(1) : "0.0",
    topTools,
    activeDays,
    avgEventsPerDay: (events.length / activeDays).toFixed(1),
  };
}

// ── Markdown generation ────────────────────────────────────────────────────

function generateMarkdownReport(
  events: any[],
  opts: { project: string; since?: string; until?: string; scope: string }
): string {
  const stats = computeStats(events);
  const now = new Date().toISOString().slice(0, 10);

  // Group events by day
  const days = new Map<string, any[]>();
  for (const event of events) {
    const day = event.timestamp ? new Date(event.timestamp).toISOString().slice(0, 10) : "unknown";
    if (!days.has(day)) days.set(day, []);
    days.get(day)!.push(event);
  }
  const sortedDays = [...days.keys()].sort().reverse();

  const dateRange = opts.since || opts.until
    ? `${opts.since || "beginning"} → ${opts.until || "now"}`
    : sortedDays.length > 1
      ? `${sortedDays[sortedDays.length - 1]} → ${sortedDays[0]}`
      : sortedDays[0] || now;

  const lines: string[] = [];

  // Title
  lines.push(`# Session Report: ${opts.project}`);
  lines.push(`_Generated ${now} | ${dateRange}_`);
  lines.push("");

  // Summary stats
  lines.push("## Summary");
  lines.push("");
  lines.push(`| Metric | Value |`);
  lines.push(`|--------|-------|`);
  lines.push(`| Active days | ${stats.activeDays} |`);
  lines.push(`| Total events | ${stats.totalEvents} |`);
  lines.push(`| Prompts | ${stats.prompts} |`);
  lines.push(`| Commits | ${stats.commits} |`);
  lines.push(`| Tool calls | ${stats.toolCalls} |`);
  lines.push(`| Corrections | ${stats.corrections} (${stats.correctionRate}% rate) |`);
  lines.push(`| Errors | ${stats.errors} |`);
  lines.push(`| Compactions | ${stats.compactions} |`);
  lines.push(`| Sub-agent spawns | ${stats.subAgentSpawns} |`);
  lines.push(`| Avg events/day | ${stats.avgEventsPerDay} |`);
  lines.push("");

  // Top tools
  if (stats.topTools.length > 0) {
    lines.push("## Top Tools");
    lines.push("");
    for (const [name, count] of stats.topTools) {
      lines.push(`- **${name}**: ${count} calls`);
    }
    lines.push("");
  }

  // Daily breakdown
  lines.push("## Daily Breakdown");
  lines.push("");

  for (const day of sortedDays) {
    const dayEvents = days.get(day)!;
    dayEvents.sort((a: any, b: any) => {
      const ta = a.timestamp ? new Date(a.timestamp).getTime() : 0;
      const tb = b.timestamp ? new Date(b.timestamp).getTime() : 0;
      return ta - tb;
    });

    const dayStats = computeStats(dayEvents);
    lines.push(`### ${day} (${dayEvents.length} events, ${dayStats.prompts} prompts, ${dayStats.commits} commits)`);
    lines.push("");

    // Show commits prominently
    const commits = dayEvents.filter((e: any) => e.type === "commit");
    if (commits.length > 0) {
      lines.push("**Commits:**");
      for (const c of commits) {
        const hash = c.commit_hash ? c.commit_hash.slice(0, 7) : "???????";
        const msg = (c.content || c.summary || "").slice(0, 120).replace(/\n/g, " ");
        const time = c.timestamp ? new Date(c.timestamp).toISOString().slice(11, 16) : "??:??";
        lines.push(`- \`${hash}\` ${time} — ${msg}`);
      }
      lines.push("");
    }

    // Show corrections
    const corrections = dayEvents.filter((e: any) => e.type === "correction");
    if (corrections.length > 0) {
      lines.push("**Corrections:**");
      for (const c of corrections) {
        const msg = (c.content || "").slice(0, 120).replace(/\n/g, " ");
        lines.push(`- ❌ ${msg}`);
      }
      lines.push("");
    }

    // Show errors
    const errors = dayEvents.filter((e: any) => e.type === "error");
    if (errors.length > 0) {
      lines.push("**Errors:**");
      for (const e of errors) {
        const msg = (e.content || "").slice(0, 120).replace(/\n/g, " ");
        lines.push(`- ⚠️ ${msg}`);
      }
      lines.push("");
    }

    // Prompt quality trend — show prompt snippets
    const prompts = dayEvents.filter((e: any) => e.type === "prompt");
    if (prompts.length > 0 && prompts.length <= 20) {
      lines.push("<details>");
      lines.push(`<summary>Prompts (${prompts.length})</summary>`);
      lines.push("");
      for (const p of prompts) {
        const time = p.timestamp ? new Date(p.timestamp).toISOString().slice(11, 16) : "??:??";
        const msg = (p.content || "").slice(0, 200).replace(/\n/g, " ");
        lines.push(`- ${time} 💬 ${msg}`);
      }
      lines.push("");
      lines.push("</details>");
      lines.push("");
    }
  }

  // Footer
  lines.push("---");
  lines.push(`_Report generated by preflight export_timeline_`);

  return lines.join("\n");
}

// ── Tool registration ──────────────────────────────────────────────────────

export function registerExportTimeline(server: McpServer): void {
  server.tool(
    "export_timeline",
    "Generate a markdown session report from timeline data. Includes summary stats, daily breakdown with commits/corrections/errors, prompt quality trends, and top tools. Optionally saves to file.",
    {
      scope: z.enum(["current", "related", "all"]).default("current").describe("Search scope"),
      project: z.string().optional().describe("Filter to a specific project (overrides scope)"),
      since: z.string().optional().describe("Start date (ISO or relative like '7days', '2weeks')"),
      until: z.string().optional().describe("End date (ISO or relative)"),
      limit: z.number().default(500).describe("Max events to include"),
      saveTo: z.string().optional().describe("File path to save the report. If omitted, returns inline."),
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
            text: `No projects found for scope "${params.scope}". Set CLAUDE_PROJECT_DIR or onboard projects first.`,
          }],
        };
      }

      const events = await getTimeline({
        project_dirs: projectDirs,
        since,
        until,
        limit: params.limit,
        offset: 0,
      });

      if (events.length === 0) {
        return {
          content: [{ type: "text", text: "No timeline events found for the given filters." }],
        };
      }

      const projectLabel = params.project || (projectDirs.length === 1 ? projectDirs[0] : `${projectDirs.length} projects`);
      const markdown = generateMarkdownReport(events, {
        project: projectLabel,
        since,
        until,
        scope: params.scope,
      });

      if (params.saveTo) {
        const outPath = params.saveTo.startsWith("/")
          ? params.saveTo
          : join(process.env.CLAUDE_PROJECT_DIR || process.cwd(), params.saveTo);
        await mkdir(dirname(outPath), { recursive: true });
        await writeFile(outPath, markdown, "utf-8");
        return {
          content: [{ type: "text", text: `✅ Report saved to ${outPath} (${events.length} events, ${markdown.length} chars)` }],
        };
      }

      return { content: [{ type: "text", text: markdown }] };
    }
  );
}
