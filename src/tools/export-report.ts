// =============================================================================
// export_report — Generate markdown session reports from timeline data
// Closes #5: Export timeline to markdown/PDF reports
// =============================================================================

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getTimeline, listIndexedProjects } from "../lib/timeline-db.js";
import { getRelatedProjects } from "../lib/config.js";
import type { SearchScope } from "../types.js";

// ── Helpers ─────────────────────────────────────────────────────────────────

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

interface DayStats {
  prompts: number;
  assistantMessages: number;
  toolCalls: number;
  corrections: number;
  commits: number;
  errors: number;
  compactions: number;
  subAgentSpawns: number;
}

function emptyDayStats(): DayStats {
  return {
    prompts: 0,
    assistantMessages: 0,
    toolCalls: 0,
    corrections: 0,
    commits: 0,
    errors: 0,
    compactions: 0,
    subAgentSpawns: 0,
  };
}

function eventTypeToDayStat(type: string): keyof DayStats | null {
  switch (type) {
    case "prompt": return "prompts";
    case "assistant": return "assistantMessages";
    case "tool_call": return "toolCalls";
    case "correction": return "corrections";
    case "commit": return "commits";
    case "error": return "errors";
    case "compaction": return "compactions";
    case "sub_agent_spawn": return "subAgentSpawns";
    default: return null;
  }
}

function correctionRate(stats: DayStats): number {
  return stats.prompts > 0 ? (stats.corrections / stats.prompts) * 100 : 0;
}

function sparkbar(value: number, max: number, width = 20): string {
  if (max === 0) return "░".repeat(width);
  const filled = Math.round((value / max) * width);
  return "█".repeat(Math.min(filled, width)) + "░".repeat(Math.max(width - filled, 0));
}

// ── Registration ────────────────────────────────────────────────────────────

export function registerExportReport(server: McpServer): void {
  server.tool(
    "export_report",
    "Generate a markdown session report from timeline data. Includes daily activity breakdown, prompt quality trends, correction rates, and commit summaries. Great for weekly standups and retrospectives.",
    {
      scope: z
        .enum(["current", "related", "all"])
        .default("current")
        .describe("Search scope"),
      period: z
        .enum(["day", "week", "month"])
        .default("week")
        .describe("Report period"),
      since: z
        .string()
        .optional()
        .describe("Start date (ISO or relative like '7days', '2weeks')"),
      until: z
        .string()
        .optional()
        .describe("End date (ISO or relative)"),
      project: z
        .string()
        .optional()
        .describe("Filter to specific project (overrides scope)"),
    },
    async (params) => {
      // Determine date range
      let sinceDate: string;
      let untilDate: string | undefined;

      if (params.since) {
        sinceDate = parseRelativeDate(params.since);
      } else {
        // Default based on period
        const d = new Date();
        switch (params.period) {
          case "day":
            d.setDate(d.getDate() - 1);
            break;
          case "week":
            d.setDate(d.getDate() - 7);
            break;
          case "month":
            d.setMonth(d.getMonth() - 1);
            break;
        }
        sinceDate = d.toISOString();
      }
      if (params.until) {
        untilDate = parseRelativeDate(params.until);
      }

      // Get projects
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
              text: `No projects found for scope "${params.scope}". Set CLAUDE_PROJECT_DIR or onboard a project first.`,
            },
          ],
        };
      }

      // Fetch all events
      const events = await getTimeline({
        project_dirs: projectDirs,
        since: sinceDate,
        until: untilDate,
        limit: 5000,
        offset: 0,
      });

      if (events.length === 0) {
        return {
          content: [
            {
              type: "text" as const,
              text: `# Session Report\n\n_No events found for the given period._`,
            },
          ],
        };
      }

      // Aggregate by day
      const dayMap = new Map<string, DayStats>();
      const commitMessages: { day: string; hash: string; message: string }[] = [];

      for (const event of events) {
        const day = event.timestamp
          ? new Date(event.timestamp).toISOString().slice(0, 10)
          : "unknown";
        if (!dayMap.has(day)) dayMap.set(day, emptyDayStats());
        const stats = dayMap.get(day)!;
        const key = eventTypeToDayStat(event.type);
        if (key) stats[key]++;

        if (event.type === "commit") {
          const ev = event as any;
          const hash = ev.commit_hash
            ? String(ev.commit_hash).slice(0, 7)
            : "";
          const message = (
            ev.content ||
            ev.summary ||
            ""
          )
            .slice(0, 80)
            .replace(/\n/g, " ");
          commitMessages.push({ day, hash, message });
        }
      }

      const sortedDays = [...dayMap.keys()].sort();
      const totalStats = emptyDayStats();
      for (const stats of dayMap.values()) {
        for (const key of Object.keys(totalStats) as (keyof DayStats)[]) {
          totalStats[key] += stats[key];
        }
      }

      // Build report
      const lines: string[] = [];
      const startDay = sortedDays[0];
      const endDay = sortedDays[sortedDays.length - 1];
      const projLabel = params.project || `${projectDirs.length} project(s)`;

      lines.push(`# Session Report: ${startDay} → ${endDay}`);
      lines.push(`_${projLabel} | ${events.length} events | ${sortedDays.length} active days_`);
      lines.push("");

      // Summary
      lines.push("## Summary");
      lines.push("");
      lines.push(`| Metric | Count |`);
      lines.push(`|--------|-------|`);
      lines.push(`| Prompts | ${totalStats.prompts} |`);
      lines.push(`| Tool calls | ${totalStats.toolCalls} |`);
      lines.push(`| Commits | ${totalStats.commits} |`);
      lines.push(`| Corrections | ${totalStats.corrections} |`);
      lines.push(`| Errors | ${totalStats.errors} |`);
      lines.push(`| Compactions | ${totalStats.compactions} |`);
      lines.push(`| Sub-agent spawns | ${totalStats.subAgentSpawns} |`);
      const overallCorrRate = correctionRate(totalStats);
      lines.push(
        `| Correction rate | ${overallCorrRate.toFixed(1)}% ${overallCorrRate > 20 ? "⚠️" : overallCorrRate > 10 ? "🟡" : "🟢"} |`,
      );
      lines.push("");

      // Daily breakdown
      lines.push("## Daily Activity");
      lines.push("");
      const maxPrompts = Math.max(...[...dayMap.values()].map((s) => s.prompts));
      for (const day of sortedDays) {
        const s = dayMap.get(day)!;
        const bar = sparkbar(s.prompts, maxPrompts, 15);
        const cr = correctionRate(s);
        const crFlag = cr > 20 ? " ⚠️" : "";
        lines.push(
          `- **${day}** ${bar} ${s.prompts}p / ${s.toolCalls}t / ${s.commits}c / ${s.corrections}err${crFlag}`,
        );
      }
      lines.push("");

      // Prompt quality trend
      if (sortedDays.length >= 2) {
        lines.push("## Prompt Quality Trend");
        lines.push("");
        const firstHalf = sortedDays.slice(0, Math.floor(sortedDays.length / 2));
        const secondHalf = sortedDays.slice(Math.floor(sortedDays.length / 2));

        const halfStats = (days: string[]) => {
          const s = emptyDayStats();
          for (const d of days) {
            const ds = dayMap.get(d)!;
            for (const k of Object.keys(s) as (keyof DayStats)[]) s[k] += ds[k];
          }
          return s;
        };

        const first = halfStats(firstHalf);
        const second = halfStats(secondHalf);
        const cr1 = correctionRate(first);
        const cr2 = correctionRate(second);
        const trend = cr2 < cr1 ? "📈 Improving" : cr2 > cr1 ? "📉 Declining" : "➡️ Stable";

        lines.push(
          `First half correction rate: ${cr1.toFixed(1)}% → Second half: ${cr2.toFixed(1)}% — ${trend}`,
        );
        lines.push("");
      }

      // Recent commits
      if (commitMessages.length > 0) {
        lines.push("## Commits");
        lines.push("");
        const recentCommits = commitMessages.slice(-20);
        for (const c of recentCommits) {
          lines.push(`- \`${c.hash}\` ${c.message} _(${c.day})_`);
        }
        lines.push("");
      }

      // Tips
      if (overallCorrRate > 15) {
        lines.push("## 💡 Recommendations");
        lines.push("");
        lines.push(
          "- High correction rate detected. Consider using `preflight_check` before complex prompts.",
        );
        lines.push(
          "- Use `clarify_intent` when requirements are ambiguous.",
        );
        lines.push(
          "- Break large tasks into smaller, more specific prompts.",
        );
        lines.push("");
      }

      lines.push(
        "_Report generated by preflight `export_report` tool._",
      );

      return {
        content: [{ type: "text" as const, text: lines.join("\n") }],
      };
    },
  );
}
