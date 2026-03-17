import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getTimeline, listIndexedProjects } from "../lib/timeline-db.js";
import { getRelatedProjects } from "../lib/config.js";
import type { SearchScope } from "../types.js";

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

/** Get project directories to search based on scope */
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

interface EventStats {
  prompts: number;
  commits: number;
  corrections: number;
  toolCalls: number;
  errors: number;
  subAgentSpawns: number;
  compactions: number;
  assistantMessages: number;
}

function computeStats(events: any[]): EventStats {
  const stats: EventStats = {
    prompts: 0,
    commits: 0,
    corrections: 0,
    toolCalls: 0,
    errors: 0,
    subAgentSpawns: 0,
    compactions: 0,
    assistantMessages: 0,
  };
  for (const e of events) {
    switch (e.type) {
      case "prompt": stats.prompts++; break;
      case "commit": stats.commits++; break;
      case "correction": stats.corrections++; break;
      case "tool_call": stats.toolCalls++; break;
      case "error": stats.errors++; break;
      case "sub_agent_spawn": stats.subAgentSpawns++; break;
      case "compaction": stats.compactions++; break;
      case "assistant": stats.assistantMessages++; break;
    }
  }
  return stats;
}

function formatPeriodLabel(period: string, since?: string, until?: string): string {
  if (since && until) return `${since} to ${until}`;
  if (period === "7days") return "Last 7 Days";
  if (period === "30days") return "Last 30 Days";
  if (period === "24hours") return "Last 24 Hours";
  return period;
}

function getDateRange(period: string): { since: string; until: string } {
  const now = new Date();
  const until = now.toISOString();
  let since: Date;

  switch (period) {
    case "24hours":
      since = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      break;
    case "7days":
      since = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      break;
    case "30days":
      since = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      break;
    default:
      since = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  }

  return { since: since.toISOString(), until };
}

export function registerExportReport(server: McpServer) {
  server.tool(
    "export_report",
    "Generate a markdown session report from timeline data. Includes activity summary, stats, prompt quality trends, commit log, and error/correction highlights for a given time period.",
    {
      scope: z.enum(["current", "related", "all"]).default("current")
        .describe("Search scope: current project, related projects, or all indexed projects"),
      project: z.string().optional()
        .describe("Filter to a specific project name (overrides scope)"),
      period: z.enum(["24hours", "7days", "30days"]).default("7days")
        .describe("Time period for the report"),
      since: z.string().optional()
        .describe("Custom start date (ISO 8601, overrides period)"),
      until: z.string().optional()
        .describe("Custom end date (ISO 8601, overrides period)"),
      branch: z.string().optional()
        .describe("Filter to a specific branch"),
      include_details: z.boolean().default(false)
        .describe("Include full event details (verbose mode)"),
    },
    async (params) => {
      // Resolve date range
      let since: string;
      let until: string;
      if (params.since && params.until) {
        since = params.since;
        until = params.until;
      } else {
        const range = getDateRange(params.period);
        since = params.since || range.since;
        until = params.until || range.until;
      }

      // Resolve projects
      let projectDirs: string[];
      if (params.project) {
        projectDirs = [params.project];
      } else {
        projectDirs = await getSearchProjects(params.scope);
      }

      if (projectDirs.length === 0) {
        return {
          content: [{
            type: "text" as const,
            text: `# Session Report\n\n_No projects found for scope "${params.scope}". Ensure CLAUDE_PROJECT_DIR is set or projects are onboarded._`,
          }],
        };
      }

      // Fetch all events in range (high limit for report)
      const events = await getTimeline({
        project_dirs: projectDirs,
        branch: params.branch,
        since,
        until,
        limit: 2000,
        offset: 0,
      });

      if (events.length === 0) {
        return {
          content: [{
            type: "text" as const,
            text: `# Session Report\n\n_No events found for ${formatPeriodLabel(params.period, params.since, params.until)}._`,
          }],
        };
      }

      const stats = computeStats(events);
      const periodLabel = formatPeriodLabel(params.period, params.since, params.until);
      const projLabel = params.project || params.scope;

      // Group by day
      const days = new Map<string, any[]>();
      for (const event of events) {
        const day = event.timestamp ? new Date(event.timestamp).toISOString().slice(0, 10) : "unknown";
        if (!days.has(day)) days.set(day, []);
        days.get(day)!.push(event);
      }
      const sortedDays = [...days.keys()].sort().reverse();

      // Build report
      const lines: string[] = [];

      // Header
      lines.push(`# 📋 Session Report: ${projLabel}`);
      lines.push(`**Period:** ${periodLabel}`);
      lines.push(`**Generated:** ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC`);
      lines.push(`**Total Events:** ${events.length}`);
      lines.push("");

      // Summary stats
      lines.push("## 📊 Summary");
      lines.push("");
      lines.push(`| Metric | Count |`);
      lines.push(`|--------|-------|`);
      lines.push(`| Prompts | ${stats.prompts} |`);
      lines.push(`| Assistant responses | ${stats.assistantMessages} |`);
      lines.push(`| Tool calls | ${stats.toolCalls} |`);
      lines.push(`| Commits | ${stats.commits} |`);
      lines.push(`| Corrections | ${stats.corrections} |`);
      lines.push(`| Errors | ${stats.errors} |`);
      lines.push(`| Sub-agent spawns | ${stats.subAgentSpawns} |`);
      lines.push(`| Compactions | ${stats.compactions} |`);
      lines.push("");

      // Prompt quality signal
      if (stats.prompts > 0) {
        const correctionRate = ((stats.corrections / stats.prompts) * 100).toFixed(1);
        const errorRate = ((stats.errors / stats.prompts) * 100).toFixed(1);
        lines.push("## 🎯 Prompt Quality Signals");
        lines.push("");
        lines.push(`- **Correction rate:** ${correctionRate}% (${stats.corrections} corrections / ${stats.prompts} prompts)`);
        lines.push(`- **Error rate:** ${errorRate}% (${stats.errors} errors / ${stats.prompts} prompts)`);
        if (stats.compactions > 0) {
          lines.push(`- **Compactions:** ${stats.compactions} (consider checkpointing more often if high)`);
        }
        lines.push("");
      }

      // Daily activity breakdown
      lines.push("## 📅 Daily Activity");
      lines.push("");
      for (const day of sortedDays) {
        const dayEvents = days.get(day)!;
        const dayStats = computeStats(dayEvents);
        const parts: string[] = [];
        if (dayStats.prompts) parts.push(`${dayStats.prompts} prompts`);
        if (dayStats.commits) parts.push(`${dayStats.commits} commits`);
        if (dayStats.toolCalls) parts.push(`${dayStats.toolCalls} tool calls`);
        if (dayStats.corrections) parts.push(`${dayStats.corrections} corrections`);
        if (dayStats.errors) parts.push(`${dayStats.errors} errors`);
        lines.push(`- **${day}**: ${parts.join(", ") || "no activity"} (${dayEvents.length} events)`);
      }
      lines.push("");

      // Commit log
      const commits = events.filter((e: any) => e.type === "commit");
      if (commits.length > 0) {
        lines.push("## 📦 Commits");
        lines.push("");
        for (const c of commits) {
          const time = c.timestamp ? new Date(c.timestamp).toISOString().slice(0, 16).replace("T", " ") : "??";
          let hash = "???";
          try { const m = JSON.parse(c.metadata || "{}"); hash = (m.commit_hash || "").slice(0, 7) || hash; } catch {}
          const msg = (c.content || "").slice(0, 120).replace(/\n/g, " ");
          lines.push(`- \`${hash}\` ${msg} _(${time})_`);
        }
        lines.push("");
      }

      // Errors & corrections
      const issues = events.filter((e: any) => e.type === "error" || e.type === "correction");
      if (issues.length > 0) {
        lines.push("## ⚠️ Errors & Corrections");
        lines.push("");
        for (const issue of issues.slice(0, 20)) {
          const icon = TYPE_ICONS[issue.type] || "❓";
          const time = issue.timestamp ? new Date(issue.timestamp).toISOString().slice(0, 16).replace("T", " ") : "??";
          const content = (issue.content || "").slice(0, 150).replace(/\n/g, " ");
          lines.push(`- ${icon} **${issue.type}** _(${time})_: ${content}`);
        }
        if (issues.length > 20) {
          lines.push(`- _...and ${issues.length - 20} more_`);
        }
        lines.push("");
      }

      // Detailed event log (optional)
      if (params.include_details) {
        lines.push("## 📝 Full Event Log");
        lines.push("");
        for (const day of sortedDays) {
          lines.push(`### ${day}`);
          const dayEvents = days.get(day)!;
          dayEvents.sort((a: any, b: any) => {
            const ta = a.timestamp ? new Date(a.timestamp).getTime() : 0;
            const tb = b.timestamp ? new Date(b.timestamp).getTime() : 0;
            return ta - tb;
          });
          for (const event of dayEvents) {
            const time = event.timestamp
              ? new Date(event.timestamp).toISOString().slice(11, 16)
              : "??:??";
            const icon = TYPE_ICONS[event.type] || "❓";
            const content = (event.content || event.summary || "").slice(0, 200).replace(/\n/g, " ");
            lines.push(`- ${time} ${icon} ${content}`);
          }
          lines.push("");
        }
      }

      lines.push("---");
      lines.push("_Generated by preflight-dev `export_report` tool_");

      return {
        content: [{
          type: "text" as const,
          text: lines.join("\n"),
        }],
      };
    }
  );
}
