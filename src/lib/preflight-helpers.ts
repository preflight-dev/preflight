// =============================================================================
// Pure helper functions for preflight_check
// Extracted for testability — no side effects, no server dependency.
// =============================================================================

/** Extract file paths from prompt text */
export function extractFilePaths(prompt: string): string[] {
  const matches = prompt.match(/[\w\-./\\]+\.\w{1,6}/g) || [];
  return [...new Set(matches)];
}

/** Detect ambiguity signals in a prompt */
export function detectAmbiguity(prompt: string, filePaths: string[]): string[] {
  const issues: string[] = [];
  if (/\b(it|them|the thing|that|those|this|these)\b/i.test(prompt))
    issues.push("Contains vague pronouns — clarify what 'it'/'them' refers to");
  if (/\b(fix|update|change|refactor|improve)\b/i.test(prompt) && !filePaths.length)
    issues.push("Vague verb without specific file targets");
  if (prompt.trim().length < 40)
    issues.push("Very short prompt — likely missing context");
  return issues;
}

/** Estimate scope complexity based on file paths */
export function estimateComplexity(filePaths: string[]): "SMALL" | "MEDIUM" | "LARGE" {
  const hasMultipleFiles = filePaths.length > 3;
  const hasMultipleDirs = new Set(filePaths.map(f => f.split("/")[0])).size > 2;
  return hasMultipleFiles && hasMultipleDirs ? "LARGE" : filePaths.length > 1 ? "MEDIUM" : "SMALL";
}

/** Classify risk level for a task description */
export function classifyRisk(text: string): "🔴 HIGH" | "🟡 MEDIUM" | "🟢 LOW" {
  if (/schema|migrat|database|config|env|deploy/i.test(text)) return "🔴 HIGH";
  if (/api|route|endpoint/i.test(text)) return "🟡 MEDIUM";
  return "🟢 LOW";
}

/** Split a prompt into sequenced sub-tasks */
export function splitSubtasks(prompt: string): string[] {
  const parts = prompt
    .split(/\b(?:then|after that|next|finally)\b|(?:,\s*and\s+)|(?:\band\b(?=\s+(?:update|add|remove|create|fix|change|refactor|implement|deploy)))/i)
    .map(s => s.trim())
    .filter(s => s.length > 5);
  return parts.length > 1 ? parts : [prompt];
}
