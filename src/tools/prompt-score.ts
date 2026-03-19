// =============================================================================
// prompt_score — Gamified prompt quality scoring
// =============================================================================

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import { scorePrompt } from "../lib/prompt-scoring.js";

interface ScoreHistory {
  scores: number[];
  sessionStart: string;
}

const STATE_DIR = join(homedir(), ".preflight");
const STATE_FILE = join(STATE_DIR, "score-history.json");

async function loadHistory(): Promise<ScoreHistory> {
  try {
    const data = await readFile(STATE_FILE, "utf-8");
    return JSON.parse(data);
  } catch {
    return { scores: [], sessionStart: new Date().toISOString() };
  }
}

async function saveHistory(history: ScoreHistory): Promise<void> {
  await mkdir(STATE_DIR, { recursive: true });
  await writeFile(STATE_FILE, JSON.stringify(history, null, 2));
}

export function registerPromptScore(server: McpServer): void {
  server.tool(
    "prompt_score",
    "Score a prompt on specificity, scope, actionability, and done-condition. Returns a letter grade with specific improvement tips.",
    {
      prompt: z.string().describe("The prompt text to score"),
    },
    async ({ prompt }) => {
      const result = scorePrompt(prompt);
      const history = await loadHistory();
      history.scores.push(result.total);
      await saveHistory(history);

      const avg = history.scores.length > 0
        ? (history.scores.reduce((a, b) => a + b, 0) / history.scores.length).toFixed(0)
        : result.total.toString();

      const report = [
        `🎯 Prompt Score: ${result.grade} (${result.total}/100)`,
        `────────────────────────`,
        `Specificity:    ${result.specificity}/25  ${result.specificity >= 20 ? "✓" : "✗"}`,
        `Scope:          ${result.scope}/25  ${result.scope >= 20 ? "✓" : "✗"}`,
        `Actionability:  ${result.actionability}/25  ${result.actionability >= 20 ? "✓" : "✗"}`,
        `Done condition: ${result.doneCondition}/25  ${result.doneCondition >= 20 ? "✓" : "✗"}`,
        ``,
        ...result.feedback,
        ``,
        `Session average: ${avg}/100 (${history.scores.length} prompts scored)`,
      ].join("\n");

      return {
        content: [{ type: "text" as const, text: report }],
      };
    }
  );
}
