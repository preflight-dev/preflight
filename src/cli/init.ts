#!/usr/bin/env node
// =============================================================================
// preflight init — Zero-config MCP server setup for Claude Code
// =============================================================================

import { createInterface } from "node:readline";
import { readFile, writeFile, mkdir, copyFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const rl = createInterface({ input: process.stdin, output: process.stdout });

function ask(question: string): Promise<string> {
  return new Promise((resolve) => rl.question(question, resolve));
}

/** Create .preflight/ directory with template files */
async function createPreflightConfig(): Promise<void> {
  const preflightDir = join(process.cwd(), ".preflight");
  
  if (existsSync(preflightDir)) {
    console.log("⚠️  .preflight/ directory already exists, skipping...\n");
    return;
  }

  try {
    await mkdir(preflightDir, { recursive: true });
    
    // Get the current module's directory to find templates
    const currentFile = fileURLToPath(import.meta.url);
    const srcDir = dirname(dirname(currentFile)); // Go up from cli/ to src/
    const templatesDir = join(srcDir, "templates");
    
    // Copy template files
    await copyFile(join(templatesDir, "config.yml"), join(preflightDir, "config.yml"));
    await copyFile(join(templatesDir, "triage.yml"), join(preflightDir, "triage.yml"));
    
    console.log("✅ Created .preflight/ directory with template config files");
    console.log("   Edit .preflight/config.yml to configure your project settings");
    console.log("   Edit .preflight/triage.yml to customize prompt triage rules\n");
  } catch (error) {
    console.error(`❌ Failed to create .preflight/ directory: ${error}\n`);
  }
}

/** Inject preflight rules into CLAUDE.md */
async function injectClaudeRules(mode: "strict" | "relaxed"): Promise<void> {
  const claudePath = join(process.cwd(), "CLAUDE.md");
  const rulesDir = join(process.cwd(), ".claude");
  const rulesPath = join(rulesDir, "preflight-rules.md");

  try {
    // Get the template
    const currentFile = fileURLToPath(import.meta.url);
    const srcDir = dirname(dirname(currentFile));
    const templatesDir = join(srcDir, "templates");
    const templateFile = join(templatesDir, `claude-rules-${mode}.md`);
    const rules = await readFile(templateFile, "utf-8");

    // Write rules to .claude/preflight-rules.md
    await mkdir(rulesDir, { recursive: true });
    await writeFile(rulesPath, rules);
    console.log(`✅ Created .claude/preflight-rules.md (${mode} mode)`);

    // Check if CLAUDE.md exists and already imports the rules
    const importLine = `@.claude/preflight-rules.md`;
    let claudeContent = "";
    try {
      claudeContent = await readFile(claudePath, "utf-8");
    } catch { /* file doesn't exist yet */ }

    if (claudeContent.includes(importLine)) {
      console.log("   CLAUDE.md already imports preflight rules\n");
      return;
    }

    // Append import to CLAUDE.md
    const separator = claudeContent.length > 0 ? "\n\n" : "";
    await writeFile(claudePath, claudeContent + separator + importLine + "\n");
    console.log("   Added import to CLAUDE.md\n");
  } catch (error) {
    console.error(`❌ Failed to inject CLAUDE.md rules: ${error}\n`);
  }
}

interface McpConfig {
  mcpServers: Record<string, {
    command: string;
    args: string[];
    env?: Record<string, string>;
  }>;
}

async function main(): Promise<void> {
  console.log("\n✈️ preflight — MCP server setup\n");

  const mcpPath = join(process.cwd(), ".mcp.json");
  let config: McpConfig;

  try {
    const existing = await readFile(mcpPath, "utf-8");
    config = JSON.parse(existing);
    if (!config.mcpServers) config.mcpServers = {};
    console.log("Found existing .mcp.json\n");
  } catch {
    config = { mcpServers: {} };
    console.log("Creating new .mcp.json\n");
  }

  console.log("Choose a profile:\n");
  console.log("  1) minimal  — 4 tools: clarify_intent, check_session_health, session_stats, prompt_score");
  console.log("  2) standard — 16 tools: all prompt discipline + session_stats + prompt_score");
  console.log("  3) full     — 20 tools: everything + timeline/vector search (needs LanceDB)\n");

  const choice = await ask("Profile [1/2/3] (default: 2): ");
  const profileMap: Record<string, string> = { "1": "minimal", "2": "standard", "3": "full" };
  const profile = profileMap[choice.trim()] || "standard";

  // Ask about creating .preflight/ directory
  console.log("\nPreflight can use either environment variables or a .preflight/ directory for configuration.");
  console.log("The .preflight/ directory allows you to configure related projects, custom triage rules, and thresholds.\n");
  
  const createConfig = await ask("Create .preflight/ directory with template config? [y/N]: ");
  if (createConfig.trim().toLowerCase() === "y" || createConfig.trim().toLowerCase() === "yes") {
    await createPreflightConfig();
  }

  // Ask about CLAUDE.md rules
  console.log("Preflight can inject rules into CLAUDE.md so Claude Code automatically");
  console.log("uses preflight tools at the right moments.\n");
  
  const rulesChoice = await ask("Add preflight rules to CLAUDE.md? [strict/relaxed/N] (default: N): ");
  const rulesMode = rulesChoice.trim().toLowerCase();
  if (rulesMode === "strict" || rulesMode === "relaxed") {
    await injectClaudeRules(rulesMode);
  }

  const env: Record<string, string> = {
    PROMPT_DISCIPLINE_PROFILE: profile,
  };

  if (profile === "full") {
    console.log("\nFull profile uses embeddings for vector search.");
    const provider = await ask("Embedding provider [local/openai] (default: local): ");
    if (provider.trim().toLowerCase() === "openai") {
      const key = await ask("OpenAI API key (or set OPENAI_API_KEY later): ");
      if (key.trim()) {
        env.OPENAI_API_KEY = key.trim();
      }
      env.EMBEDDING_PROVIDER = "openai";
    } else {
      env.EMBEDDING_PROVIDER = "local";
    }
  }

  // Use npx to run the MCP server via the dedicated serve binary.
  // "preflight-dev" runs the init wizard; "preflight-dev-serve" starts the server.
  config.mcpServers["preflight"] = {
    command: "npx",
    args: ["-y", "preflight-dev-serve"],
    env,
  };

  await writeFile(mcpPath, JSON.stringify(config, null, 2) + "\n");

  console.log(`\n✅ preflight added! (profile: ${profile})`);
  console.log("Restart Claude Code to connect.\n");

  rl.close();
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
