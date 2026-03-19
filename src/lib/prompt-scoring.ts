// =============================================================================
// prompt-scoring — Pure scoring logic extracted from prompt_score tool
// =============================================================================

export interface ScoreResult {
  specificity: number;
  scope: number;
  actionability: number;
  doneCondition: number;
  total: number;
  grade: string;
  feedback: string[];
}

export function scorePrompt(text: string): ScoreResult {
  const feedback: string[] = [];
  let specificity: number;
  let scope: number;
  let actionability: number;
  let doneCondition: number;

  // Specificity: file paths, function names, specific identifiers
  if (/[/\\][\w.-]+\.\w+/.test(text) || /`[^`]+`/.test(text)) {
    specificity = 25;
  } else if (/\b(file|component|function|class|module|test|route)\b/i.test(text)) {
    specificity = 15;
    feedback.push("📁 Name the specific file/function for +10 points");
  } else {
    specificity = 5;
    feedback.push("📁 No specific targets mentioned — which file? which function?");
  }

  // Scope: bounded task
  // Check for bounding keywords first; length alone isn't enough
  const hasBoundingKeyword = /\b(only|just|single|one|specific|this)\b/i.test(text);
  const hasBroadKeyword = /\b(all|every|entire|whole)\b/i.test(text);

  if (hasBoundingKeyword) {
    scope = 25;
  } else if (hasBroadKeyword) {
    scope = 10;
    feedback.push("🎯 'All/every' is broad — can you narrow the scope?");
  } else if (text.length > 100) {
    // Long prompts often imply scope, but not as strong as explicit keywords
    scope = 20;
  } else {
    scope = 10;
    feedback.push("🎯 Scope unclear — how much should change?");
  }

  // Actionability: clear verb
  const actionVerbs =
    /\b(add|remove|rename|refactor|fix|create|delete|update|change|replace|move|extract|implement|write|test|migrate)\b/i;
  if (actionVerbs.test(text)) {
    actionability = 25;
  } else if (/\b(make|do|handle|work|improve|clean)\b/i.test(text)) {
    actionability = 15;
    feedback.push("⚡ Vague verb — 'fix' beats 'make work', 'extract' beats 'clean up'");
  } else {
    actionability = 5;
    feedback.push("⚡ What's the action? Use a specific verb (add, remove, rename, etc.)");
  }

  // Done condition: verifiable outcome
  if (
    /\b(should|must|expect|assert|return|output|pass|fail|error|log|print|display)\b/i.test(text)
  ) {
    doneCondition = 25;
  } else if (/\?$/.test(text.trim())) {
    doneCondition = 20; // questions are inherently verifiable
  } else {
    doneCondition = 5;
    feedback.push("✅ No done condition — how will you know it worked?");
  }

  const total = specificity + scope + actionability + doneCondition;

  let grade: string;
  if (total >= 90) grade = "A+";
  else if (total >= 85) grade = "A";
  else if (total >= 80) grade = "A-";
  else if (total >= 75) grade = "B+";
  else if (total >= 70) grade = "B";
  else if (total >= 65) grade = "B-";
  else if (total >= 60) grade = "C+";
  else if (total >= 55) grade = "C";
  else if (total >= 45) grade = "D";
  else grade = "F";

  if (feedback.length === 0) {
    feedback.push("🏆 Excellent prompt! Clear target, scope, action, and done condition.");
  }

  return { specificity, scope, actionability, doneCondition, total, grade, feedback };
}
