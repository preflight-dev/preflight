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

interface GroupedEvents {
  days: Map<string, any[]>;
  totalEvents: number;
  dateRange: string;
}

async function fetchAndGroup(params: {
  scope: "current" | "related" | "all";
  project?: string;
  branch?: string;
  author?: string;
  since?: string;
  until?: string;
  type?: string;
}): Promise<GroupedEvents> {
  const since = params.since ? parseRelativeDate(params.since) : undefined;
  const until = params.until ? parseRelativeDate(params.until) : undefined;

  let projectDirs: string[];
  if (params.project) {
    projectDirs = [params.project];
  } else {
    projectDirs = await getSearchProjects(params.scope);
  }

  let events = await getTimeline({
    project_dirs: projectDirs,
    project: undefined,
    branch: params.branch,
    since,
    until,
    type: params.type === "all" || !params.type ? undefined : (params.type as any),
    limit: 10000,
    offset: 0,
  });

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

  const days = new Map<string, any[]>();
  for (const event of events) {
    const day = event.timestamp
      ? new Date(event.timestamp).toISOString().slice(0, 10)
      : "unknown";
    if (!days.has(day)) days.set(day, []);
    days.get(day)!.push(event);
  }

  const sortedDays = [...days.keys()].sort().reverse();
  const dateRange =
    sortedDays.length > 1
      ? `${sortedDays[sortedDays.length - 1]} to ${sortedDays[0]}`
      : sortedDays[0] || "no data";

  return { days, totalEvents: events.length, dateRange };
}

function computeStats(days: Map<string, any[]>) {
  let totalPrompts = 0;
  let totalAssistant = 0;
  let totalToolCalls = 0;
  let totalCommits = 0;
  let totalCorrections = 0;
  let totalErrors = 0;
  let totalCompactions = 0;
  let totalSubAgents = 0;

  for (const events of days.values()) {
    for (const e of events) {
      switch (e.type) {
        case "prompt": totalPrompts++; break;
        case "assistant": totalAssistant++; break;
        case "tool_call": totalToolCalls++; break;
        case "commit": totalCommits++; break;
        case "correction": totalCorrections++; break;
        case "error": totalErrors++; break;
        case "compaction": totalCompactions++; break;
        case "sub_agent_spawn": totalSubAgents++; break;
      }
    }
  }

  return {
    totalPrompts,
    totalAssistant,
    totalToolCalls,
    totalCommits,
    totalCorrections,
    totalErrors,
    totalCompactions,
    totalSubAgents,
  };
}

function renderMarkdown(
  grouped: GroupedEvents,
  projectLabel: string,
  branch?: string,
  format: "detailed" | "summary" = "detailed"
): string {
  const { days, totalEvents, dateRange } = grouped;
  const stats = computeStats(days);
  const sortedDays = [...days.keys()].sort().reverse();
  const branchStr = branch ? ` (${branch})` : "";
  const generated = new Date().toISOString().slice(0, 19).replace("T", " ");

  const lines: string[] = [
    `# Session Report: ${projectLabel}${branchStr}`,
    "",
    `**Period:** ${dateRange}  `,
    `**Generated:** ${generated}  `,
    `**Total Events:** ${totalEvents}`,
    "",
    "## Summary",
    "",
    `| Metric | Count |`,
    `|--------|-------|`,
    `| Prompts | ${stats.totalPrompts} |`,
    `| Responses | ${stats.totalAssistant} |`,
    `| Tool Calls | ${stats.totalToolCalls} |`,
    `| Commits | ${stats.totalCommits} |`,
    `| Corrections | ${stats.totalCorrections} |`,
    `| Errors | ${stats.totalErrors} |`,
    `| Compactions | ${stats.totalCompactions} |`,
    `| Sub-agents | ${stats.totalSubAgents} |`,
    "",
  ];

  // Prompt quality indicator
  if (stats.totalPrompts > 0) {
    const correctionRate = stats.totalCorrections / stats.totalPrompts;
    const quality =
      correctionRate < 0.05 ? "🟢 Excellent" :
      correctionRate < 0.15 ? "🟡 Good" :
      correctionRate < 0.3 ? "🟠 Needs Improvement" :
      "🔴 Poor";
    lines.push(
      "## Prompt Quality",
      "",
      `- **Correction Rate:** ${(correctionRate * 100).toFixed(1)}% (${stats.totalCorrections}/${stats.totalPrompts})`,
      `- **Quality Rating:** ${quality}`,
      "",
    );
  }

  // Daily breakdown
  if (format === "detailed") {
    lines.push("## Daily Breakdown", "");

    for (const day of sortedDays) {
      const dayEvents = days.get(day)!;
      dayEvents.sort((a: any, b: any) => {
        const ta = a.timestamp ? new Date(a.timestamp).getTime() : 0;
        const tb = b.timestamp ? new Date(b.timestamp).getTime() : 0;
        return ta - tb;
      });

      const dayStats = computeStats(new Map([["day", dayEvents]]));
      lines.push(
        `### ${day} (${dayEvents.length} events)`,
        "",
      );

      // Day summary line
      const parts: string[] = [];
      if (dayStats.totalPrompts) parts.push(`${dayStats.totalPrompts} prompts`);
      if (dayStats.totalCommits) parts.push(`${dayStats.totalCommits} commits`);
      if (dayStats.totalToolCalls) parts.push(`${dayStats.totalToolCalls} tool calls`);
      if (dayStats.totalCorrections) parts.push(`${dayStats.totalCorrections} corrections`);
      if (dayStats.totalErrors) parts.push(`${dayStats.totalErrors} errors`);
      if (parts.length) lines.push(`> ${parts.join(" · ")}`, "");

      for (const event of dayEvents) {
        const time = event.timestamp
          ? new Date(event.timestamp).toISOString().slice(11, 16)
          : "??:??";
        const icon = TYPE_ICONS[event.type] || "❓";
        let content = (event.content || event.summary || "")
          .slice(0, 200)
          .replace(/\n/g, " ");

        if (event.type === "commit") {
          const hash = event.commit_hash ? event.commit_hash.slice(0, 7) : "";
          content = `\`${hash}\` ${content}`;
        } else if (event.type === "tool_call") {
          const tool = event.tool_name || "";
          const target = content ? ` → ${content}` : "";
          content = `\`${tool}\`${target}`;
        }

        lines.push(`- ${time} ${icon} ${content}`);
      }
      lines.push("");
    }
  } else {
    // Summary mode: just daily counts
    lines.push("## Daily Activity", "");
    lines.push("| Date | Prompts | Commits | Tools | Corrections | Errors |");
    lines.push("|------|---------|---------|-------|-------------|--------|");

    for (const day of sortedDays) {
      const dayEvents = days.get(day)!;
      const ds = computeStats(new Map([["day", dayEvents]]));
      lines.push(
        `| ${day} | ${ds.totalPrompts} | ${ds.totalCommits} | ${ds.totalToolCalls} | ${ds.totalCorrections} | ${ds.totalErrors} |`
      );
    }
    lines.push("");
  }

  lines.push("---", `_Generated by preflight export_timeline_`);
  return lines.join("\n");
}

export function registerExportTimeline(server: McpServer) {
  server.tool(
    "export_timeline",
    "Export timeline data as a markdown report with summary stats, prompt quality trends, and daily breakdowns. Use for weekly summaries, retrospectives, and session analysis.",
    {
      scope: z
        .enum(["current", "related", "all"])
        .default("current")
        .describe("Search scope"),
      project: z.string().optional().describe("Filter to a specific project"),
      branch: z.string().optional(),
      author: z.string().optional().describe("Filter commits by author"),
      since: z
        .string()
        .optional()
        .describe("Start date (ISO or relative like '7days', '1week')"),
      until: z.string().optional().describe("End date"),
      format: z
        .enum(["detailed", "summary"])
        .default("detailed")
        .describe("detailed = full event log; summary = daily counts table"),
    },
    async (params) => {
      const grouped = await fetchAndGroup({
        scope: params.scope,
        project: params.project,
        branch: params.branch,
        author: params.author,
        since: params.since,
        until: params.until,
      });

      if (grouped.totalEvents === 0) {
        return {
          content: [
            {
              type: "text",
              text: `# Session Report\n\n_No events found for the given filters. Make sure projects are onboarded with \`onboard_project\`._`,
            },
          ],
        };
      }

      const projectLabel =
        params.project || params.scope === "current"
          ? process.env.CLAUDE_PROJECT_DIR || "current project"
          : params.scope;

      const markdown = renderMarkdown(
        grouped,
        projectLabel,
        params.branch,
        params.format
      );

      return {
        content: [{ type: "text", text: markdown }],
      };
    }
  );
}
