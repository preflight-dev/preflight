// =============================================================================
// export_report — Generate markdown session reports from timeline data
// Closes #5: Export timeline to markdown reports
// =============================================================================

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  findSessionDirs,
  findSessionFiles,
  parseSession,
  type TimelineEvent,
} from "../lib/session-parser.js";
import { writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { homedir } from "os";

// ── Helpers ────────────────────────────────────────────────────────────────

function dayKey(ts: string): string {
  return new Date(ts).toISOString().slice(0, 10);
}

function weekKey(ts: string): string {
  const d = new Date(ts);
  // ISO week: Monday-based
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;
}

interface EventStats {
  prompts: number;
  corrections: number;
  toolCalls: number;
  commits: number;
  compactions: number;
  errors: number;
  subAgentSpawns: number;
}

function emptyStats(): EventStats {
  return { prompts: 0, corrections: 0, toolCalls: 0, commits: 0, compactions: 0, errors: 0, subAgentSpawns: 0 };
}

function tally(stats: EventStats, event: TimelineEvent): void {
  switch (event.type) {
    case "prompt": stats.prompts++; break;
    case "correction": stats.corrections++; break;
    case "tool_call": stats.toolCalls++; break;
    case "commit": stats.commits++; break;
    case "compaction": stats.compactions++; break;
    case "error": stats.errors++; break;
    case "sub_agent_spawn": stats.subAgentSpawns++; break;
  }
}

function correctionRate(stats: EventStats): string {
  if (stats.prompts === 0) return "N/A";
  return ((stats.corrections / stats.prompts) * 100).toFixed(1) + "%";
}

function formatStats(stats: EventStats): string {
  const lines: string[] = [];
  lines.push(`| Metric | Count |`);
  lines.push(`|--------|-------|`);
  lines.push(`| Prompts | ${stats.prompts} |`);
  lines.push(`| Tool calls | ${stats.toolCalls} |`);
  lines.push(`| Commits | ${stats.commits} |`);
  lines.push(`| Corrections | ${stats.corrections} (${correctionRate(stats)}) |`);
  lines.push(`| Compactions | ${stats.compactions} |`);
  lines.push(`| Errors | ${stats.errors} |`);
  lines.push(`| Sub-agent spawns | ${stats.subAgentSpawns} |`);
  return lines.join("\n");
}

// ── Tool registration ──────────────────────────────────────────────────────

export function registerExportReport(server: McpServer) {
  server.tool(
    "export_report",
    "Generate a markdown summary report from session timeline data. Supports daily and weekly summaries with prompt quality trends, correction rates, and activity breakdowns.",
    {
      period: z.enum(["day", "week"]).default("week").describe("Aggregation period"),
      days: z.number().default(7).describe("How many days back to include"),
      project: z.string().optional().describe("Filter to a specific project directory"),
      save: z.boolean().default(false).describe("Save to ~/.preflight/reports/"),
    },
    async (params) => {
      // Collect events
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - params.days);
      const cutoffISO = cutoff.toISOString();

      const sessionDirs = findSessionDirs();
      let allEvents: TimelineEvent[] = [];

      for (const dir of sessionDirs) {
        if (params.project && !dir.project.includes(params.project)) continue;
        const files = findSessionFiles(dir.sessionDir);
        for (const file of files) {
          try {
            const events = parseSession(file.path, dir.project, dir.projectName);
            for (const ev of events) {
              if (ev.timestamp >= cutoffISO) {
                allEvents.push(ev);
              }
            }
          } catch {
            // skip unparseable files
          }
        }
      }

      if (allEvents.length === 0) {
        return {
          content: [{
            type: "text",
            text: `## Report\n_No events found in the last ${params.days} days._`,
          }],
        };
      }

      // Sort chronologically
      allEvents.sort((a, b) => a.timestamp.localeCompare(b.timestamp));

      // Group by period
      const groupFn = params.period === "day" ? dayKey : weekKey;
      const groups = new Map<string, TimelineEvent[]>();
      for (const ev of allEvents) {
        const key = groupFn(ev.timestamp);
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key)!.push(ev);
      }

      // Build report
      const totalStats = emptyStats();
      allEvents.forEach((ev) => tally(totalStats, ev));

      const sortedKeys = [...groups.keys()].sort();
      const periodLabel = params.period === "day" ? "Daily" : "Weekly";
      const dateRange = `${sortedKeys[0]} → ${sortedKeys[sortedKeys.length - 1]}`;

      const lines: string[] = [
        `# ${periodLabel} Session Report`,
        `_Generated ${new Date().toISOString().slice(0, 10)} · ${dateRange} · ${allEvents.length} events_`,
        "",
        "## Summary",
        "",
        formatStats(totalStats),
        "",
      ];

      // Correction trend
      if (sortedKeys.length > 1) {
        lines.push("## Correction Rate Trend");
        lines.push("");
        for (const key of sortedKeys) {
          const periodEvents = groups.get(key)!;
          const ps = emptyStats();
          periodEvents.forEach((ev) => tally(ps, ev));
          const bar = "█".repeat(Math.round(ps.corrections));
          lines.push(`- **${key}**: ${correctionRate(ps)} ${bar} (${ps.prompts} prompts, ${ps.corrections} corrections)`);
        }
        lines.push("");
      }

      // Per-period breakdown
      lines.push(`## ${periodLabel} Breakdown`);
      lines.push("");

      for (const key of sortedKeys) {
        const periodEvents = groups.get(key)!;
        const ps = emptyStats();
        periodEvents.forEach((ev) => tally(ps, ev));

        lines.push(`### ${key}`);
        lines.push("");
        lines.push(`${periodEvents.length} events · ${ps.prompts} prompts · ${ps.commits} commits · ${correctionRate(ps)} correction rate`);
        lines.push("");

        // Top commits
        const commits = periodEvents.filter((e) => e.type === "commit");
        if (commits.length > 0) {
          lines.push("**Commits:**");
          for (const c of commits.slice(0, 10)) {
            const preview = c.content_preview || c.content.slice(0, 80);
            lines.push(`- ${preview}`);
          }
          lines.push("");
        }

        // Errors
        const errors = periodEvents.filter((e) => e.type === "error");
        if (errors.length > 0) {
          lines.push("**Errors:**");
          for (const e of errors.slice(0, 5)) {
            lines.push(`- ⚠️ ${(e.content_preview || e.content).slice(0, 100)}`);
          }
          lines.push("");
        }
      }

      const report = lines.join("\n");

      // Optionally save
      if (params.save) {
        const reportDir = join(homedir(), ".preflight", "reports");
        mkdirSync(reportDir, { recursive: true });
        const filename = `report-${params.period}-${new Date().toISOString().slice(0, 10)}.md`;
        const filepath = join(reportDir, filename);
        writeFileSync(filepath, report, "utf-8");
        return {
          content: [{
            type: "text",
            text: report + `\n\n_Saved to \`${filepath}\`_`,
          }],
        };
      }

      return { content: [{ type: "text", text: report }] };
    }
  );
}
