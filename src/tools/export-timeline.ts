// =============================================================================
// export_timeline — Generate markdown reports from timeline data
// Closes #5: Export timeline to markdown/PDF reports
// =============================================================================

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getTimeline, listIndexedProjects } from "../lib/timeline-db.js";
import { getRelatedProjects } from "../lib/config.js";
import { writeFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { homedir } from "os";
import type { SearchScope } from "../types.js";

// ── Helpers ────────────────────────────────────────────────────────────────

function parseRelativeDate(input: string): string {
  const match = input.match(/^(\d+)(days?|weeks?|months?)$/);
  if (!match) return input;
  const [, numStr, unit] = match;
  const num = parseInt(numStr, 10);
  const d = new Date();
  if (unit.startsWith("day")) d.setDate(d.getDate() - num);
  else if (unit.startsWith("week")) d.setDate(d.getDate() - num * 7);
  else if (unit.startsWith("month")) d.setMonth(d.getMonth() - num);
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

interface EventRecord {
  timestamp: string;
  type: string;
  content?: string;
  summary?: string;
  commit_hash?: string;
  tool_name?: string;
  metadata?: string;
  project?: string;
  project_name?: string;
}

// ── Report Generators ──────────────────────────────────────────────────────

function generateDailyBreakdown(events: EventRecord[]): string {
  const days = new Map<string, EventRecord[]>();
  for (const e of events) {
    const day = e.timestamp
      ? new Date(e.timestamp).toISOString().slice(0, 10)
      : "unknown";
    if (!days.has(day)) days.set(day, []);
    days.get(day)!.push(e);
  }

  const lines: string[] = [];
  const sortedDays = [...days.keys()].sort().reverse();

  for (const day of sortedDays) {
    const dayEvents = days.get(day)!;
    lines.push(`### ${day}`);
    lines.push("");

    // Summary counts
    const counts: Record<string, number> = {};
    for (const e of dayEvents) {
      counts[e.type] = (counts[e.type] || 0) + 1;
    }
    const countStr = Object.entries(counts)
      .map(([t, c]) => `${TYPE_ICONS[t] || "❓"} ${t}: ${c}`)
      .join(" · ");
    lines.push(`> ${countStr}`);
    lines.push("");

    // Events
    dayEvents.sort(
      (a, b) =>
        new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    );
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
          ? event.commit_hash.slice(0, 7) + " "
          : "";
        content = `\`${hash}\`${content}`;
      } else if (event.type === "tool_call") {
        const tool = event.tool_name || "";
        content = tool + (content ? ` → ${content}` : "");
      }

      lines.push(`- \`${time}\` ${icon} ${content}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

function generateWeeklySummary(events: EventRecord[]): string {
  // Group by ISO week
  const weeks = new Map<string, EventRecord[]>();
  for (const e of events) {
    const d = new Date(e.timestamp);
    const weekStart = new Date(d);
    weekStart.setDate(d.getDate() - d.getDay());
    const key = weekStart.toISOString().slice(0, 10);
    if (!weeks.has(key)) weeks.set(key, []);
    weeks.get(key)!.push(e);
  }

  const lines: string[] = [];
  const sortedWeeks = [...weeks.keys()].sort().reverse();

  for (const weekKey of sortedWeeks) {
    const weekEvents = weeks.get(weekKey)!;
    const weekEnd = new Date(weekKey);
    weekEnd.setDate(weekEnd.getDate() + 6);

    lines.push(
      `### Week of ${weekKey} → ${weekEnd.toISOString().slice(0, 10)}`
    );
    lines.push("");

    // Type breakdown
    const counts: Record<string, number> = {};
    for (const e of weekEvents) {
      counts[e.type] = (counts[e.type] || 0) + 1;
    }

    lines.push("| Type | Count |");
    lines.push("|------|-------|");
    for (const [type, count] of Object.entries(counts).sort(
      (a, b) => b[1] - a[1]
    )) {
      lines.push(`| ${TYPE_ICONS[type] || "❓"} ${type} | ${count} |`);
    }
    lines.push("");

    // Commits this week
    const commits = weekEvents.filter((e) => e.type === "commit");
    if (commits.length > 0) {
      lines.push("**Commits:**");
      for (const c of commits.slice(0, 10)) {
        const hash = c.commit_hash ? c.commit_hash.slice(0, 7) : "???????";
        const msg = (c.content || c.summary || "").slice(0, 100).replace(/\n/g, " ");
        lines.push(`- \`${hash}\` ${msg}`);
      }
      if (commits.length > 10) {
        lines.push(`- _...and ${commits.length - 10} more_`);
      }
      lines.push("");
    }

    // Corrections (prompt quality signal)
    const corrections = weekEvents.filter((e) => e.type === "correction");
    if (corrections.length > 0) {
      lines.push(
        `**Corrections:** ${corrections.length} (prompt quality signal)`
      );
      lines.push("");
    }

    // Errors
    const errors = weekEvents.filter((e) => e.type === "error");
    if (errors.length > 0) {
      lines.push(`**Errors:** ${errors.length}`);
      for (const err of errors.slice(0, 5)) {
        const msg = (err.content || err.summary || "").slice(0, 100).replace(/\n/g, " ");
        lines.push(`- ⚠️ ${msg}`);
      }
      lines.push("");
    }
  }

  return lines.join("\n");
}

function generateTrendAnalysis(events: EventRecord[]): string {
  if (events.length === 0) return "_No events to analyze._\n";

  // Group by day for trends
  const days = new Map<string, Record<string, number>>();
  for (const e of events) {
    const day = new Date(e.timestamp).toISOString().slice(0, 10);
    if (!days.has(day)) days.set(day, {});
    const counts = days.get(day)!;
    counts[e.type] = (counts[e.type] || 0) + 1;
    counts["_total"] = (counts["_total"] || 0) + 1;
  }

  const sortedDays = [...days.keys()].sort();
  const totalDays = sortedDays.length;

  const lines: string[] = [];

  // Overall stats
  const totalEvents = events.length;
  const avgPerDay = (totalEvents / totalDays).toFixed(1);
  lines.push(`**Period:** ${sortedDays[0]} → ${sortedDays[sortedDays.length - 1]} (${totalDays} days)`);
  lines.push(`**Total events:** ${totalEvents} (avg ${avgPerDay}/day)`);
  lines.push("");

  // Type distribution
  const typeCounts: Record<string, number> = {};
  for (const e of events) {
    typeCounts[e.type] = (typeCounts[e.type] || 0) + 1;
  }

  lines.push("**Event distribution:**");
  lines.push("");
  lines.push("| Type | Count | % |");
  lines.push("|------|-------|---|");
  for (const [type, count] of Object.entries(typeCounts).sort(
    (a, b) => b[1] - a[1]
  )) {
    const pct = ((count / totalEvents) * 100).toFixed(1);
    lines.push(`| ${TYPE_ICONS[type] || "❓"} ${type} | ${count} | ${pct}% |`);
  }
  lines.push("");

  // Correction rate trend (prompt quality)
  const corrections = events.filter((e) => e.type === "correction").length;
  const prompts = events.filter((e) => e.type === "prompt").length;
  if (prompts > 0) {
    const correctionRate = ((corrections / prompts) * 100).toFixed(1);
    lines.push(
      `**Correction rate:** ${correctionRate}% (${corrections} corrections / ${prompts} prompts)`
    );
    if (parseFloat(correctionRate) > 20) {
      lines.push(
        `> ⚠️ High correction rate suggests prompt quality could improve`
      );
    } else if (parseFloat(correctionRate) < 5) {
      lines.push(`> ✅ Low correction rate — prompts are landing well`);
    }
    lines.push("");
  }

  // Activity sparkline (simple ASCII bar chart)
  if (sortedDays.length > 1) {
    lines.push("**Daily activity:**");
    lines.push("```");
    const maxCount = Math.max(...sortedDays.map((d) => days.get(d)!["_total"]));
    const barWidth = 30;
    for (const day of sortedDays.slice(-14)) {
      // last 14 days
      const count = days.get(day)!["_total"];
      const bar = "█".repeat(Math.round((count / maxCount) * barWidth));
      lines.push(`${day.slice(5)} ${bar} ${count}`);
    }
    lines.push("```");
    lines.push("");
  }

  return lines.join("\n");
}

// ── Main Registration ──────────────────────────────────────────────────────

export function registerExportTimeline(server: McpServer) {
  server.tool(
    "export_timeline",
    "Export timeline data as a structured markdown report. Generates daily breakdowns, weekly summaries, and prompt quality trend analysis. Optionally saves to a file.",
    {
      scope: z
        .enum(["current", "related", "all"])
        .default("current")
        .describe("Search scope"),
      project: z
        .string()
        .optional()
        .describe("Filter to specific project (overrides scope)"),
      since: z
        .string()
        .optional()
        .describe(
          'Start date — ISO string or relative like "7days", "2weeks", "1month"'
        ),
      until: z.string().optional().describe("End date"),
      format: z
        .enum(["daily", "weekly", "trends", "full"])
        .default("full")
        .describe(
          "Report format: daily breakdown, weekly summary, trend analysis, or full (all sections)"
        ),
      save_path: z
        .string()
        .optional()
        .describe(
          "Save report to this file path. If omitted, returns report as text."
        ),
      limit: z.number().default(500).describe("Max events to include"),
    },
    async (params) => {
      const since = params.since
        ? parseRelativeDate(params.since)
        : undefined;
      const until = params.until
        ? parseRelativeDate(params.until)
        : undefined;

      // Determine projects
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
              type: "text" as const,
              text: "No events found for the given filters.",
            },
          ],
        };
      }

      // Build report
      const projLabel = params.project || params.scope;
      const dateRange = since || until
        ? `${since?.slice(0, 10) || "start"} → ${until?.slice(0, 10) || "now"}`
        : "all time";

      const sections: string[] = [
        `# Timeline Report: ${projLabel}`,
        `_Generated ${new Date().toISOString().slice(0, 16)} · ${events.length} events · ${dateRange}_`,
        "",
        "---",
        "",
      ];

      if (params.format === "full" || params.format === "trends") {
        sections.push("## Trends & Analysis");
        sections.push("");
        sections.push(generateTrendAnalysis(events));
      }

      if (params.format === "full" || params.format === "weekly") {
        sections.push("## Weekly Summary");
        sections.push("");
        sections.push(generateWeeklySummary(events));
      }

      if (params.format === "full" || params.format === "daily") {
        sections.push("## Daily Breakdown");
        sections.push("");
        sections.push(generateDailyBreakdown(events));
      }

      const report = sections.join("\n");

      // Optionally save to file
      if (params.save_path) {
        const resolvedPath = params.save_path.startsWith("~")
          ? join(homedir(), params.save_path.slice(1))
          : params.save_path;
        mkdirSync(dirname(resolvedPath), { recursive: true });
        writeFileSync(resolvedPath, report, "utf-8");
        return {
          content: [
            {
              type: "text" as const,
              text: `Report saved to \`${resolvedPath}\` (${report.length} chars, ${events.length} events)`,
            },
          ],
        };
      }

      return {
        content: [{ type: "text" as const, text: report }],
      };
    }
  );
}
