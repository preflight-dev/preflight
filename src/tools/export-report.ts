// =============================================================================
// export_report — Generate markdown reports from timeline data
// Implements: https://github.com/TerminalGravity/preflight/issues/5
// =============================================================================

import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getTimeline, listIndexedProjects } from "../lib/timeline-db.js";
import { getRelatedProjects } from "../lib/config.js";
import { writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import type { SearchScope } from "../types.js";

// --- Helpers ---

function getWeekStart(date: Date): string {
  const d = new Date(date);
  d.setDate(d.getDate() - d.getDay());
  return d.toISOString().slice(0, 10);
}

function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
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
  timestamp?: string;
  type: string;
  content?: string;
  summary?: string;
  commit_hash?: string;
  tool_name?: string;
  metadata?: string;
  project_name?: string;
}

// --- Report generators ---

function generateWeeklySummary(
  events: EventRecord[],
  projectName: string,
  weekOf: string,
): string {
  const counts: Record<string, number> = {};
  for (const e of events) {
    counts[e.type] = (counts[e.type] || 0) + 1;
  }

  const commits = events.filter((e) => e.type === "commit");
  const corrections = events.filter((e) => e.type === "correction");
  const prompts = events.filter((e) => e.type === "prompt");
  const errors = events.filter((e) => e.type === "error");

  // Group by day
  const days = new Map<string, EventRecord[]>();
  for (const e of events) {
    const day = e.timestamp
      ? new Date(e.timestamp).toISOString().slice(0, 10)
      : "unknown";
    if (!days.has(day)) days.set(day, []);
    days.get(day)!.push(e);
  }

  const lines: string[] = [
    `# Weekly Report: ${projectName}`,
    `**Week of ${weekOf}**`,
    `_Generated ${new Date().toISOString().slice(0, 10)}_`,
    "",
    "## Summary",
    "",
    `| Metric | Count |`,
    `|--------|-------|`,
    `| Total events | ${events.length} |`,
    `| Prompts | ${prompts.length} |`,
    `| Commits | ${commits.length} |`,
    `| Corrections | ${corrections.length} |`,
    `| Errors | ${errors.length} |`,
    `| Active days | ${days.size} |`,
    "",
  ];

  // Prompt quality signal
  if (prompts.length > 0 && corrections.length > 0) {
    const correctionRate = ((corrections.length / prompts.length) * 100).toFixed(
      1,
    );
    lines.push(
      `## Prompt Quality`,
      "",
      `- Correction rate: **${correctionRate}%** (${corrections.length} corrections / ${prompts.length} prompts)`,
      "",
    );
  }

  // Commits
  if (commits.length > 0) {
    lines.push("## Commits", "");
    for (const c of commits) {
      const hash = c.commit_hash ? c.commit_hash.slice(0, 7) : "???????";
      const msg = (c.content || c.summary || "").slice(0, 100).replace(/\n/g, " ");
      lines.push(`- \`${hash}\` ${msg}`);
    }
    lines.push("");
  }

  // Corrections (lessons learned)
  if (corrections.length > 0) {
    lines.push("## Corrections", "");
    for (const c of corrections.slice(0, 10)) {
      const msg = (c.content || c.summary || "").slice(0, 120).replace(/\n/g, " ");
      lines.push(`- ${msg}`);
    }
    if (corrections.length > 10) {
      lines.push(`- _...and ${corrections.length - 10} more_`);
    }
    lines.push("");
  }

  // Errors
  if (errors.length > 0) {
    lines.push("## Errors", "");
    for (const e of errors.slice(0, 5)) {
      const msg = (e.content || e.summary || "").slice(0, 120).replace(/\n/g, " ");
      lines.push(`- ⚠️ ${msg}`);
    }
    if (errors.length > 5) {
      lines.push(`- _...and ${errors.length - 5} more_`);
    }
    lines.push("");
  }

  // Daily breakdown
  lines.push("## Daily Activity", "");
  const sortedDays = [...days.keys()].sort();
  for (const day of sortedDays) {
    const dayEvents = days.get(day)!;
    const dayCounts: Record<string, number> = {};
    for (const e of dayEvents) {
      dayCounts[e.type] = (dayCounts[e.type] || 0) + 1;
    }
    const parts = Object.entries(dayCounts)
      .map(([t, c]) => `${c} ${t}${c > 1 ? "s" : ""}`)
      .join(", ");
    lines.push(`- **${day}**: ${parts}`);
  }
  lines.push("");

  return lines.join("\n");
}

function generateActivityReport(
  events: EventRecord[],
  projectName: string,
  since: string,
  until: string,
): string {
  const lines: string[] = [
    `# Activity Report: ${projectName}`,
    `**${since.slice(0, 10)} to ${until.slice(0, 10)}**`,
    `_Generated ${new Date().toISOString().slice(0, 10)}_`,
    "",
  ];

  // Type breakdown
  const counts: Record<string, number> = {};
  for (const e of events) {
    counts[e.type] = (counts[e.type] || 0) + 1;
  }

  lines.push("## Event Breakdown", "", "| Type | Count |", "|------|-------|");
  for (const [type, count] of Object.entries(counts).sort(
    (a, b) => b[1] - a[1],
  )) {
    lines.push(`| ${type} | ${count} |`);
  }
  lines.push("");

  // Tool usage
  const toolCalls = events.filter((e) => e.type === "tool_call");
  if (toolCalls.length > 0) {
    const toolCounts: Record<string, number> = {};
    for (const e of toolCalls) {
      const name = e.tool_name || "unknown";
      toolCounts[name] = (toolCounts[name] || 0) + 1;
    }
    lines.push(
      "## Tool Usage",
      "",
      "| Tool | Calls |",
      "|------|-------|",
    );
    for (const [tool, count] of Object.entries(toolCounts).sort(
      (a, b) => b[1] - a[1],
    )) {
      lines.push(`| ${tool} | ${count} |`);
    }
    lines.push("");
  }

  // Timeline (condensed)
  const days = new Map<string, number>();
  for (const e of events) {
    const day = e.timestamp
      ? new Date(e.timestamp).toISOString().slice(0, 10)
      : "unknown";
    days.set(day, (days.get(day) || 0) + 1);
  }

  lines.push("## Activity Heatmap", "");
  for (const [day, count] of [...days.entries()].sort()) {
    const bar = "█".repeat(Math.min(count, 40));
    lines.push(`${day} ${bar} ${count}`);
  }
  lines.push("");

  return lines.join("\n");
}

// --- Registration ---

export function registerExportReport(server: McpServer) {
  server.tool(
    "export_report",
    "Generate markdown reports from timeline data. Weekly summaries, activity reports, and prompt quality trends.",
    {
      scope: z
        .enum(["current", "related", "all"])
        .default("current")
        .describe("Search scope"),
      project: z
        .string()
        .optional()
        .describe("Filter to specific project (overrides scope)"),
      format: z
        .enum(["weekly", "activity"])
        .default("weekly")
        .describe(
          "Report format: weekly (7-day summary) or activity (custom range)",
        ),
      since: z
        .string()
        .optional()
        .describe("Start date (ISO or relative like '7days'). Default: 7 days ago"),
      until: z
        .string()
        .optional()
        .describe("End date (ISO or relative). Default: now"),
      save: z
        .boolean()
        .default(false)
        .describe("Save to ~/.preflight/reports/"),
    },
    async (params) => {
      const sinceDate = params.since || daysAgo(7);
      const untilDate = params.until || new Date().toISOString();

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
              type: "text" as const,
              text: `No projects found for scope "${params.scope}". Onboard a project first.`,
            },
          ],
        };
      }

      // Fetch events
      const events = (await getTimeline({
        project_dirs: projectDirs,
        since: sinceDate,
        until: untilDate,
        limit: 1000,
        offset: 0,
      })) as EventRecord[];

      if (events.length === 0) {
        return {
          content: [
            {
              type: "text" as const,
              text: "No events found for the given time range.",
            },
          ],
        };
      }

      const projectName =
        params.project || events[0]?.project_name || "Project";

      let report: string;
      if (params.format === "weekly") {
        const weekOf = getWeekStart(new Date(sinceDate));
        report = generateWeeklySummary(events, projectName, weekOf);
      } else {
        report = generateActivityReport(
          events,
          projectName,
          sinceDate,
          untilDate,
        );
      }

      // Optionally save
      if (params.save) {
        const reportsDir = join(homedir(), ".preflight", "reports");
        mkdirSync(reportsDir, { recursive: true });
        const filename = `${params.format}-${new Date().toISOString().slice(0, 10)}.md`;
        const filepath = join(reportsDir, filename);
        writeFileSync(filepath, report, "utf-8");
        report += `\n---\n_Saved to ${filepath}_\n`;
      }

      return {
        content: [{ type: "text" as const, text: report }],
      };
    },
  );
}
