import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getTimeline } from "../lib/timeline-db.js";
import { getSearchProjects } from "../lib/search-projects.js";
import { TYPE_LABELS, TYPE_ICONS } from "../lib/event-labels.js";
import type { SearchScope } from "../types.js";

function getDateRange(
  period: string,
  customSince?: string,
  customUntil?: string,
): { since: string; until: string; label: string } {
  const now = new Date();

  if (period === "custom" && customSince) {
    return {
      since: customSince,
      until: customUntil || now.toISOString(),
      label: `${customSince.slice(0, 10)} to ${(customUntil || now.toISOString()).slice(0, 10)}`,
    };
  }

  const end = new Date(now);
  const start = new Date(now);

  switch (period) {
    case "today":
      start.setHours(0, 0, 0, 0);
      return { since: start.toISOString(), until: end.toISOString(), label: start.toISOString().slice(0, 10) };
    case "yesterday": {
      start.setDate(start.getDate() - 1);
      start.setHours(0, 0, 0, 0);
      const endOfDay = new Date(start);
      endOfDay.setHours(23, 59, 59, 999);
      return { since: start.toISOString(), until: endOfDay.toISOString(), label: start.toISOString().slice(0, 10) };
    }
    case "week":
      start.setDate(start.getDate() - 7);
      return { since: start.toISOString(), until: end.toISOString(), label: `Week of ${start.toISOString().slice(0, 10)}` };
    case "month":
      start.setMonth(start.getMonth() - 1);
      return { since: start.toISOString(), until: end.toISOString(), label: `Past month (${start.toISOString().slice(0, 10)} – ${end.toISOString().slice(0, 10)})` };
    case "sprint":
      start.setDate(start.getDate() - 14);
      return { since: start.toISOString(), until: end.toISOString(), label: `Sprint (${start.toISOString().slice(0, 10)} – ${end.toISOString().slice(0, 10)})` };
    default:
      start.setDate(start.getDate() - 7);
      return { since: start.toISOString(), until: end.toISOString(), label: `Week of ${start.toISOString().slice(0, 10)}` };
  }
}

interface TypeStats {
  count: number;
  label: string;
}

export function registerExportReport(server: McpServer) {
  server.tool(
    "export_report",
    "Generate a markdown summary report from timeline data. Produces session summaries with activity breakdowns, daily trends, commit logs, correction patterns, and prompt quality indicators.",
    {
      scope: z
        .enum(["current", "related", "all"])
        .default("current")
        .describe("Search scope: current project, related projects, or all indexed"),
      project: z.string().optional().describe("Filter to a specific project (overrides scope)"),
      period: z
        .enum(["today", "yesterday", "week", "sprint", "month", "custom"])
        .default("week")
        .describe("Report period"),
      since: z.string().optional().describe("Custom start date (ISO 8601, used with period=custom)"),
      until: z.string().optional().describe("Custom end date (ISO 8601, used with period=custom)"),
      branch: z.string().optional().describe("Filter to a specific branch"),
      sections: z
        .array(z.enum(["summary", "daily", "commits", "corrections", "prompts"]))
        .default(["summary", "daily", "commits", "corrections"])
        .describe("Report sections to include"),
    },
    async (params) => {
      const { since, until, label } = getDateRange(params.period, params.since, params.until);

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
              text: `# Report\n\n_No projects found for scope "${params.scope}". Ensure CLAUDE_PROJECT_DIR is set or projects are onboarded._`,
            },
          ],
        };
      }

      // Fetch all events for the period (up to 500)
      const events = await getTimeline({
        project_dirs: projectDirs,
        branch: params.branch,
        since,
        until,
        limit: 500,
      });

      if (events.length === 0) {
        return {
          content: [
            {
              type: "text",
              text: `# Session Report — ${label}\n\n_No events found for this period._`,
            },
          ],
        };
      }

      const lines: string[] = [];
      const projLabel = params.project || (projectDirs.length === 1 ? projectDirs[0].split("/").pop() : `${projectDirs.length} projects`);

      lines.push(`# Session Report — ${projLabel}`);
      lines.push(`**Period:** ${label}  `);
      if (params.branch) lines.push(`**Branch:** ${params.branch}  `);
      lines.push(`**Generated:** ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC`);
      lines.push("");

      // --- Summary section ---
      if (params.sections.includes("summary")) {
        const typeCounts = new Map<string, number>();
        for (const e of events) {
          typeCounts.set(e.type, (typeCounts.get(e.type) || 0) + 1);
        }

        const uniqueSessions = new Set(events.map((e: any) => e.session_id).filter(Boolean));
        const uniqueBranches = new Set(events.map((e: any) => e.branch).filter(Boolean));

        lines.push("## Summary");
        lines.push("");
        lines.push(`- **Total events:** ${events.length}`);
        lines.push(`- **Sessions:** ${uniqueSessions.size}`);
        if (uniqueBranches.size > 0) {
          lines.push(`- **Branches:** ${[...uniqueBranches].join(", ")}`);
        }
        lines.push("");

        lines.push("### Activity Breakdown");
        lines.push("");
        // Sort by count descending
        const sorted = [...typeCounts.entries()].sort((a, b) => b[1] - a[1]);
        for (const [type, count] of sorted) {
          const icon = TYPE_ICONS[type] || "❓";
          const typeLabel = TYPE_LABELS[type] || type;
          lines.push(`- ${icon} **${typeLabel}:** ${count}`);
        }

        // Correction ratio
        const prompts = typeCounts.get("prompt") || 0;
        const corrections = typeCounts.get("correction") || 0;
        if (prompts > 0) {
          const ratio = ((corrections / prompts) * 100).toFixed(1);
          lines.push("");
          lines.push(`**Correction rate:** ${ratio}% (${corrections}/${prompts} prompts needed correction)`);
        }

        lines.push("");
      }

      // --- Daily breakdown ---
      if (params.sections.includes("daily")) {
        const days = new Map<string, Map<string, number>>();
        for (const e of events) {
          const day = e.timestamp ? new Date(e.timestamp).toISOString().slice(0, 10) : "unknown";
          if (!days.has(day)) days.set(day, new Map());
          const dayMap = days.get(day)!;
          dayMap.set(e.type, (dayMap.get(e.type) || 0) + 1);
        }

        lines.push("## Daily Activity");
        lines.push("");

        const sortedDays = [...days.keys()].sort().reverse();
        for (const day of sortedDays) {
          const dayCounts = days.get(day)!;
          const total = [...dayCounts.values()].reduce((a, b) => a + b, 0);
          const parts = [...dayCounts.entries()]
            .sort((a, b) => b[1] - a[1])
            .map(([type, count]) => `${TYPE_ICONS[type] || "❓"}${count}`)
            .join(" ");
          lines.push(`- **${day}** — ${total} events: ${parts}`);
        }
        lines.push("");
      }

      // --- Commits ---
      if (params.sections.includes("commits")) {
        const commits = events.filter((e: any) => e.type === "commit");
        if (commits.length > 0) {
          lines.push("## Commits");
          lines.push("");
          for (const c of commits) {
            const time = c.timestamp ? new Date(c.timestamp).toISOString().slice(0, 16).replace("T", " ") : "??";
            const msg = (c.content || "").slice(0, 120).replace(/\n/g, " ");
            let meta: any = {};
            try { meta = JSON.parse(c.metadata || "{}"); } catch {}
            const hash = meta.hash ? `\`${meta.hash.slice(0, 7)}\`` : "";
            const author = meta.author ? ` (${meta.author})` : "";
            lines.push(`- ${hash} ${msg}${author} — _${time}_`);
          }
          lines.push("");
        }
      }

      // --- Corrections ---
      if (params.sections.includes("corrections")) {
        const corrections = events.filter((e: any) => e.type === "correction");
        if (corrections.length > 0) {
          lines.push("## Corrections");
          lines.push("");
          lines.push("_These indicate where the agent needed to be redirected._");
          lines.push("");
          for (const c of corrections) {
            const time = c.timestamp ? new Date(c.timestamp).toISOString().slice(0, 16).replace("T", " ") : "??";
            const msg = (c.content || "").slice(0, 150).replace(/\n/g, " ");
            lines.push(`- ❌ "${msg}" — _${time}_`);
          }
          lines.push("");
        }
      }

      // --- Prompt quality indicators ---
      if (params.sections.includes("prompts")) {
        const prompts = events.filter((e: any) => e.type === "prompt");
        if (prompts.length > 0) {
          // Basic stats on prompt lengths
          const lengths = prompts.map((p: any) => (p.content || "").length);
          const avgLen = Math.round(lengths.reduce((a: number, b: number) => a + b, 0) / lengths.length);
          const maxLen = Math.max(...lengths);
          const minLen = Math.min(...lengths);

          lines.push("## Prompt Quality Indicators");
          lines.push("");
          lines.push(`- **Total prompts:** ${prompts.length}`);
          lines.push(`- **Avg length:** ${avgLen} chars`);
          lines.push(`- **Range:** ${minLen}–${maxLen} chars`);

          // Flag very short prompts (likely vague)
          const shortPrompts = prompts.filter((p: any) => (p.content || "").length < 30);
          if (shortPrompts.length > 0) {
            lines.push(`- **Short prompts (<30 chars):** ${shortPrompts.length} — these may lack context`);
          }
          lines.push("");
        }
      }

      lines.push("---");
      lines.push(`_Report generated by preflight-dev export_report_`);

      return { content: [{ type: "text", text: lines.join("\n") }] };
    },
  );
}
