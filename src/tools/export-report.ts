// =============================================================================
// export_report — Export timeline data as formatted markdown reports
// Closes #5: Export timeline to markdown/PDF reports
// =============================================================================

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { getTimeline, listIndexedProjects } from "../lib/timeline-db.js";
import { getRelatedProjects } from "../lib/config.js";
import type { SearchScope } from "../types.js";

// ── Types ──────────────────────────────────────────────────────────────────

interface ReportEvent {
  timestamp: string;
  type: string;
  content: string;
  summary?: string;
  commit_hash?: string;
  tool_name?: string;
  metadata?: string;
}

interface DaySummary {
  date: string;
  events: ReportEvent[];
  promptCount: number;
  commitCount: number;
  toolCallCount: number;
  correctionCount: number;
  errorCount: number;
}

// ── Helpers ────────────────────────────────────────────────────────────────

const TYPE_ICONS: Record<string, string> = {
  prompt: "💬",
  user_prompt: "💬",
  assistant: "🤖",
  assistant_response: "🤖",
  tool_call: "🔧",
  correction: "❌",
  commit: "📦",
  git_commit: "📦",
  compaction: "🗜️",
  sub_agent_spawn: "🚀",
  error: "⚠️",
};

const TYPE_LABELS: Record<string, string> = {
  prompt: "Prompts",
  user_prompt: "Prompts",
  assistant: "Responses",
  assistant_response: "Responses",
  tool_call: "Tool Calls",
  correction: "Corrections",
  commit: "Commits",
  git_commit: "Commits",
  compaction: "Compactions",
  sub_agent_spawn: "Sub-agents",
  error: "Errors",
};

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

async function resolveProjects(scope: SearchScope): Promise<string[]> {
  const current = process.env.CLAUDE_PROJECT_DIR;
  switch (scope) {
    case "current":
      return current ? [current] : [];
    case "related": {
      const related = getRelatedProjects();
      return current ? [current, ...related] : related;
    }
    case "all": {
      const projects = await listIndexedProjects();
      return projects.map((p) => p.project);
    }
    default:
      return current ? [current] : [];
  }
}

function groupByDay(events: ReportEvent[]): DaySummary[] {
  const days = new Map<string, ReportEvent[]>();
  for (const event of events) {
    const day = event.timestamp
      ? new Date(event.timestamp).toISOString().slice(0, 10)
      : "unknown";
    if (!days.has(day)) days.set(day, []);
    days.get(day)!.push(event);
  }

  const summaries: DaySummary[] = [];
  for (const [date, dayEvents] of days) {
    dayEvents.sort(
      (a, b) =>
        new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
    );
    summaries.push({
      date,
      events: dayEvents,
      promptCount: dayEvents.filter(
        (e) => e.type === "prompt" || e.type === "user_prompt",
      ).length,
      commitCount: dayEvents.filter(
        (e) => e.type === "commit" || e.type === "git_commit",
      ).length,
      toolCallCount: dayEvents.filter((e) => e.type === "tool_call").length,
      correctionCount: dayEvents.filter((e) => e.type === "correction").length,
      errorCount: dayEvents.filter((e) => e.type === "error").length,
    });
  }

  summaries.sort((a, b) => b.date.localeCompare(a.date));
  return summaries;
}

// ── Report Generators ──────────────────────────────────────────────────────

function generateSummaryReport(
  days: DaySummary[],
  project: string,
  period: string,
): string {
  const totalEvents = days.reduce((s, d) => s + d.events.length, 0);
  const totalPrompts = days.reduce((s, d) => s + d.promptCount, 0);
  const totalCommits = days.reduce((s, d) => s + d.commitCount, 0);
  const totalToolCalls = days.reduce((s, d) => s + d.toolCallCount, 0);
  const totalCorrections = days.reduce((s, d) => s + d.correctionCount, 0);
  const totalErrors = days.reduce((s, d) => s + d.errorCount, 0);

  const dateRange =
    days.length > 1
      ? `${days[days.length - 1].date} → ${days[0].date}`
      : days[0]?.date ?? "N/A";

  const lines: string[] = [
    `# 📋 Session Report: ${project}`,
    ``,
    `**Period:** ${period} (${dateRange})  `,
    `**Days active:** ${days.length}  `,
    `**Total events:** ${totalEvents}`,
    ``,
    `## Overview`,
    ``,
    `| Metric | Count |`,
    `|--------|-------|`,
    `| 💬 Prompts | ${totalPrompts} |`,
    `| 📦 Commits | ${totalCommits} |`,
    `| 🔧 Tool Calls | ${totalToolCalls} |`,
    `| ❌ Corrections | ${totalCorrections} |`,
    `| ⚠️ Errors | ${totalErrors} |`,
    ``,
  ];

  // Correction rate
  if (totalPrompts > 0) {
    const correctionRate = ((totalCorrections / totalPrompts) * 100).toFixed(1);
    lines.push(
      `**Correction rate:** ${correctionRate}% (${totalCorrections}/${totalPrompts} prompts)  `,
    );
    const commitFreq =
      totalCommits > 0
        ? `every ~${Math.round(totalPrompts / totalCommits)} prompts`
        : "none";
    lines.push(`**Commit frequency:** ${commitFreq}`, ``);
  }

  // Daily breakdown
  lines.push(`## Daily Activity`, ``);
  for (const day of days) {
    const stats = [
      day.promptCount > 0 ? `${day.promptCount} prompts` : null,
      day.commitCount > 0 ? `${day.commitCount} commits` : null,
      day.toolCallCount > 0 ? `${day.toolCallCount} tools` : null,
      day.correctionCount > 0 ? `${day.correctionCount} corrections` : null,
      day.errorCount > 0 ? `${day.errorCount} errors` : null,
    ]
      .filter(Boolean)
      .join(", ");

    lines.push(`### ${day.date} (${day.events.length} events)`);
    lines.push(`${stats}`, ``);

    // Show commits for the day
    const commits = day.events.filter(
      (e) => e.type === "commit" || e.type === "git_commit",
    );
    if (commits.length > 0) {
      for (const c of commits) {
        const hash = c.commit_hash ? c.commit_hash.slice(0, 7) : "";
        const msg = (c.content || c.summary || "").slice(0, 100);
        const time = new Date(c.timestamp).toISOString().slice(11, 16);
        lines.push(`- ${time} 📦 \`${hash}\` ${msg}`);
      }
      lines.push(``);
    }

    // Show errors if any
    const errors = day.events.filter((e) => e.type === "error");
    if (errors.length > 0) {
      for (const e of errors) {
        const time = new Date(e.timestamp).toISOString().slice(11, 16);
        const msg = (e.content || e.summary || "").slice(0, 120);
        lines.push(`- ${time} ⚠️ ${msg}`);
      }
      lines.push(``);
    }
  }

  // Quality trends (if multi-day)
  if (days.length >= 3) {
    lines.push(`## Trends`, ``);

    const firstHalf = days.slice(Math.floor(days.length / 2));
    const secondHalf = days.slice(0, Math.floor(days.length / 2));

    const avgCorrectionsFirst =
      firstHalf.reduce((s, d) => s + d.correctionCount, 0) / firstHalf.length;
    const avgCorrectionsSecond =
      secondHalf.reduce((s, d) => s + d.correctionCount, 0) /
      secondHalf.length;

    if (avgCorrectionsSecond < avgCorrectionsFirst) {
      lines.push(
        `- ✅ Correction rate improved: ${avgCorrectionsFirst.toFixed(1)} → ${avgCorrectionsSecond.toFixed(1)} per day`,
      );
    } else if (avgCorrectionsSecond > avgCorrectionsFirst) {
      lines.push(
        `- ⚠️ Correction rate increased: ${avgCorrectionsFirst.toFixed(1)} → ${avgCorrectionsSecond.toFixed(1)} per day`,
      );
    }

    const avgCommitsFirst =
      firstHalf.reduce((s, d) => s + d.commitCount, 0) / firstHalf.length;
    const avgCommitsSecond =
      secondHalf.reduce((s, d) => s + d.commitCount, 0) / secondHalf.length;

    if (avgCommitsSecond > avgCommitsFirst) {
      lines.push(
        `- ✅ Commit frequency improved: ${avgCommitsFirst.toFixed(1)} → ${avgCommitsSecond.toFixed(1)} per day`,
      );
    }

    lines.push(``);
  }

  lines.push(
    `---`,
    `_Generated by [preflight](https://github.com/TerminalGravity/preflight) on ${new Date().toISOString().slice(0, 10)}_`,
  );

  return lines.join("\n");
}

function generateDetailedReport(
  days: DaySummary[],
  project: string,
  period: string,
): string {
  const summary = generateSummaryReport(days, project, period);
  const lines: string[] = [summary, ``, `## Detailed Timeline`, ``];

  for (const day of days) {
    lines.push(`### ${day.date}`, ``);
    for (const event of day.events) {
      const time = event.timestamp
        ? new Date(event.timestamp).toISOString().slice(11, 16)
        : "??:??";
      const icon = TYPE_ICONS[event.type] || "❓";
      let content = (event.content || event.summary || "")
        .slice(0, 200)
        .replace(/\n/g, " ");

      if (event.type === "commit" || event.type === "git_commit") {
        const hash = event.commit_hash ? event.commit_hash.slice(0, 7) : "";
        lines.push(`- ${time} ${icon} \`${hash}\` ${content}`);
      } else if (event.type === "tool_call") {
        const tool = event.tool_name || "";
        lines.push(
          `- ${time} ${icon} **${tool}** ${content ? `→ ${content}` : ""}`,
        );
      } else {
        lines.push(`- ${time} ${icon} ${content}`);
      }
    }
    lines.push(``);
  }

  return lines.join("\n");
}

// ── Registration ───────────────────────────────────────────────────────────

export function registerExportReport(server: McpServer): void {
  server.tool(
    "export_report",
    "Export a session timeline report as formatted markdown. Generates daily summaries with commit history, correction rates, prompt quality trends, and activity breakdowns. Save to file for sharing or archival.",
    {
      scope: z
        .enum(["current", "related", "all"])
        .default("current")
        .describe("Search scope for projects"),
      project: z
        .string()
        .optional()
        .describe("Filter to specific project (overrides scope)"),
      since: z
        .string()
        .optional()
        .describe("Start date (ISO or relative: '7days', '2weeks', '1month')"),
      until: z.string().optional().describe("End date (ISO or relative)"),
      detail: z
        .enum(["summary", "detailed"])
        .default("summary")
        .describe(
          "Report detail level: summary (daily stats + commits) or detailed (full timeline)",
        ),
      output_path: z
        .string()
        .optional()
        .describe(
          "Save report to this file path. If omitted, returns inline.",
        ),
      limit: z
        .number()
        .default(500)
        .describe("Maximum events to include"),
    },
    async (params) => {
      const since = params.since
        ? parseRelativeDate(params.since)
        : undefined;
      const until = params.until
        ? parseRelativeDate(params.until)
        : undefined;

      // Resolve projects
      let projectDirs: string[];
      if (params.project) {
        projectDirs = [params.project];
      } else {
        projectDirs = await resolveProjects(params.scope);
      }

      if (projectDirs.length === 0) {
        return {
          content: [
            {
              type: "text" as const,
              text: `No projects found for scope "${params.scope}". Set CLAUDE_PROJECT_DIR or onboard a project first.`,
            },
          ],
        };
      }

      // Fetch timeline events
      const events = (await getTimeline({
        project_dirs: projectDirs,
        project: undefined,
        branch: undefined,
        since,
        until,
        type: undefined,
        limit: params.limit,
        offset: 0,
      })) as ReportEvent[];

      if (events.length === 0) {
        return {
          content: [
            {
              type: "text" as const,
              text: "No events found for the given filters. Try broadening the time range or checking the project name.",
            },
          ],
        };
      }

      const days = groupByDay(events);
      const projectName =
        params.project || projectDirs[0]?.split("/").pop() || "unknown";
      const period = params.since || "recent";

      const report =
        params.detail === "detailed"
          ? generateDetailedReport(days, projectName, period)
          : generateSummaryReport(days, projectName, period);

      // Save to file if requested
      if (params.output_path) {
        try {
          mkdirSync(dirname(params.output_path), { recursive: true });
          writeFileSync(params.output_path, report, "utf-8");
          return {
            content: [
              {
                type: "text" as const,
                text: `✅ Report saved to ${params.output_path} (${report.length} chars, ${days.length} days, ${events.length} events)\n\n${report}`,
              },
            ],
          };
        } catch (err) {
          return {
            content: [
              {
                type: "text" as const,
                text: `⚠️ Failed to save report: ${err}\n\n${report}`,
              },
            ],
          };
        }
      }

      return {
        content: [{ type: "text" as const, text: report }],
      };
    },
  );
}
