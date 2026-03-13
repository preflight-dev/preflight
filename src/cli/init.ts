#!/usr/bin/env node
// =============================================================================
// preflight init — Zero-config MCP server setup for Claude Code
// =============================================================================

import { createInterface } from "node:readline";
import { readFile, writeFile, mkdir, copyFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

// ---------------------------------------------------------------------------
// CLI flags: --help, --version, --profile, --config
// ---------------------------------------------------------------------------
const { values: flags } = parseArgs({
  options: {
    help:    { type: "boolean", short: "h", default: false },
    version: { type: "boolean", short: "v", default: false },
    profile: { type: "string",  short: "p" },
    config:  { type: "boolean", short: "c", default: false },
  },
  strict: false,
});

if (flags.help) {
  console.log(`
✈️  preflight-dev — MCP server setup for Claude Code

Usage:
  preflight-dev              Interactive setup wizard
  preflight-dev --help       Show this help
  preflight-dev --version    Print version

Options:
  -p, --profile <name>   Skip prompt — use minimal, standard, or full
  -c, --config           Auto-create .preflight/ directory with templates
  -h, --help             Show this help message
  -v, --version          Print version and exit

Profiles:
  minimal    4 tools  — clarify_intent, check_session_health, session_stats, prompt_score
  standard   16 tools — all prompt discipline + session_stats + prompt_score
  full       20 tools — everything + timeline/vector search (needs LanceDB)

Examples:
  preflight-dev                      # Interactive wizard
  preflight-dev -p standard -c       # Non-interactive: standard profile + .preflight/ config
  npx preflight-dev-serve            # Start the MCP server (used by .mcp.json)

Docs: https://github.com/TerminalGravity/preflight
`);
  process.exit(0);
}

if (flags.version) {
  const currentFile = fileURLToPath(import.meta.url);
  const pkgPath = join(dirname(dirname(currentFile)), "package.json");
  try {
    const pkg = JSON.parse(await readFile(pkgPath, "utf-8"));
    console.log(pkg.version);
  } catch {
    // Fallback: try the repo-root package.json (when running from dist/)
    try {
      const rootPkg = JSON.parse(await readFile(join(dirname(dirname(dirname(currentFile))), "package.json"), "utf-8"));
      console.log(rootPkg.version);
    } catch {
      console.log("unknown");
    }
  }
  process.exit(0);
}

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

  let profile: string;

  // Non-interactive mode when --profile is passed
  if (flags.profile) {
    const valid = ["minimal", "standard", "full"];
    profile = valid.includes(flags.profile as string) ? (flags.profile as string) : "standard";
    console.log(`Using profile: ${profile}\n`);
  } else {
    console.log("Choose a profile:\n");
    console.log("  1) minimal  — 4 tools: clarify_intent, check_session_health, session_stats, prompt_score");
    console.log("  2) standard — 16 tools: all prompt discipline + session_stats + prompt_score");
    console.log("  3) full     — 20 tools: everything + timeline/vector search (needs LanceDB)\n");

    const choice = await ask("Profile [1/2/3] (default: 2): ");
    const profileMap: Record<string, string> = { "1": "minimal", "2": "standard", "3": "full" };
    profile = profileMap[choice.trim()] || "standard";
  }

  // .preflight/ config directory
  if (flags.config) {
    await createPreflightConfig();
  } else if (!flags.profile) {
    // Only ask interactively if not in non-interactive mode
    console.log("\nPreflight can use either environment variables or a .preflight/ directory for configuration.");
    console.log("The .preflight/ directory allows you to configure related projects, custom triage rules, and thresholds.\n");
    
    const createConfig = await ask("Create .preflight/ directory with template config? [y/N]: ");
    if (createConfig.trim().toLowerCase() === "y" || createConfig.trim().toLowerCase() === "yes") {
      await createPreflightConfig();
    }
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
