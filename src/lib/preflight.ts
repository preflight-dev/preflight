/**
 * Pure helper functions for the preflight_check tool.
 * Extracted for testability — no side effects in pure functions.
 */

/** Extract file paths from prompt text */
export function extractFilePaths(prompt: string): string[] {
  // Match standard paths (src/foo.ts) and dotfiles (.env, .gitignore)
  const standard = prompt.match(/[\w\-./\\]+\.\w{1,6}/g) || [];
  const dotfiles = prompt.match(/(?:^|\s)(\.[\w\-.]+)/g) || [];
  const cleaned = dotfiles.map(s => s.trim());
  return [...new Set([...standard, ...cleaned])];
}

/** Detect ambiguity signals in a prompt */
export function detectAmbiguity(prompt: string): string[] {
  const issues: string[] = [];
  const filePaths = extractFilePaths(prompt);

  if (/\b(it|them|the thing|that|those|this|these)\b/i.test(prompt))
    issues.push("Contains vague pronouns — clarify what 'it'/'them' refers to");
  if (/\b(fix|update|change|refactor|improve)\b/i.test(prompt) && !filePaths.length)
    issues.push("Vague verb without specific file targets");
  if (prompt.trim().length < 40)
    issues.push("Very short prompt — likely missing context");

  return issues;
}

/** Estimate scope complexity from file paths */
export function estimateComplexity(filePaths: string[]): "SMALL" | "MEDIUM" | "LARGE" {
  const hasMultipleFiles = filePaths.length > 3;
  const hasMultipleDirs = new Set(filePaths.map(f => f.split("/")[0])).size > 2;
  return hasMultipleFiles && hasMultipleDirs ? "LARGE" : filePaths.length > 1 ? "MEDIUM" : "SMALL";
}

/** Split a prompt into sequenced sub-tasks */
export function splitSubtasks(prompt: string): { task: string; risk: string }[] {
  const parts = prompt
    .split(/\b(?:then|after that|next|finally)\b|(?:,\s*and\s+)|(?:\band\b(?=\s+(?:update|add|remove|create|fix|change|refactor|implement|deploy)))/i)
    .map(s => s.trim())
    .filter(s => s.length > 5);

  if (parts.length <= 1) {
    return [{ task: prompt.slice(0, 100), risk: "🟡 MEDIUM" }];
  }

  return parts.map(part => {
    const risk = /schema|migrat|database|config|env|deploy/i.test(part) ? "🔴 HIGH" :
                 /api|route|endpoint/i.test(part) ? "🟡 MEDIUM" : "🟢 LOW";
    return { task: part.charAt(0).toUpperCase() + part.slice(1), risk };
  });
}
