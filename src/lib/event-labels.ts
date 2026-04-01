/**
 * Shared event type labels and icons for timeline display.
 * Used by timeline-view, export-report, and other tools.
 */

export const TYPE_LABELS: Record<string, string> = {
  prompt: "Prompts",
  assistant: "Responses",
  tool_call: "Tool Calls",
  correction: "Corrections",
  commit: "Commits",
  compaction: "Compactions",
  sub_agent_spawn: "Sub-agent Spawns",
  error: "Errors",
};

export const TYPE_ICONS: Record<string, string> = {
  prompt: "💬",
  assistant: "🤖",
  tool_call: "🔧",
  correction: "❌",
  commit: "📦",
  compaction: "🗜️",
  sub_agent_spawn: "🚀",
  error: "⚠️",
};
