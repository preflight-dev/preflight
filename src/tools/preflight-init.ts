import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { existsSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { PROJECT_DIR } from "../lib/files.js";

const CONFIG_YML = `# .preflight/config.yml — Preflight configuration
# See: https://github.com/TerminalGravity/preflight

# Profile controls check depth: minimal | standard | full
profile: standard

# Related projects for cross-service awareness
# related_projects:
#   - path: ../auth-service
#     alias: auth
#   - path: ../payments
#     alias: payments

# Thresholds
thresholds:
  session_stale_minutes: 30
  max_tool_calls_before_checkpoint: 100
  correction_pattern_threshold: 3

# Embedding provider: local | openai
embeddings:
  provider: local
`;

const TRIAGE_YML = `# .preflight/triage.yml — Triage classification rules
# Controls how prompts are classified before deciding what checks to run.

strictness: standard  # relaxed | standard | strict

rules:
  # Always run full preflight for prompts matching these keywords
  always_check:
    - migration
    - schema
    - permissions
    - rewards

  # Skip preflight entirely for these (fast-pass)
  skip:
    - commit
    - format
    - lint

  # Keywords that trigger cross-service checks
  cross_service_keywords:
    - auth
    - notification
    - event
    - webhook
`;

const RULES_MD = `# Project Rules

<!-- Add project-specific rules that preflight should surface on every non-trivial check. -->
<!-- These appear in preflight_check output to remind the agent of conventions. -->

## Examples (delete these and add your own)

- Always run \`npm test\` before committing
- Never modify the migrations table directly
- Use the \`logger\` module, not \`console.log\`
`;

const PATTERNS_JSON = `[
  {
    "id": "example-wrong-import",
    "pattern": "Used default import instead of named import",
    "keywords": ["import", "default", "named"],
    "frequency": 1,
    "lastSeen": "",
    "context": "Example pattern — delete or replace with real patterns",
    "examples": ["import Foo from './foo' should be import { Foo } from './foo'"]
  }
]
`;

const GITIGNORE = `# Auto-generated patterns go in preflight-state, not here
# This directory is for version-controlled config only
`;

export function registerPreflightInit(server: McpServer): void {
  server.tool(
    "preflight_init",
    "Scaffold a .preflight/ config directory in the current project. Creates config.yml, triage.yml, rules.md, contracts/, and patterns.json with sensible defaults.",
    {
      project_dir: z.string().optional().describe("Project directory (defaults to current working directory)"),
      force: z.boolean().default(false).describe("Overwrite existing files"),
    },
    async ({ project_dir, force }) => {
      const dir = project_dir || PROJECT_DIR;
      const preflightDir = join(dir, ".preflight");
      const contractsDir = join(preflightDir, "contracts");

      const created: string[] = [];
      const skipped: string[] = [];

      // Create directories
      if (!existsSync(preflightDir)) {
        mkdirSync(preflightDir, { recursive: true });
        created.push(".preflight/");
      }
      if (!existsSync(contractsDir)) {
        mkdirSync(contractsDir, { recursive: true });
        created.push(".preflight/contracts/");
      }

      // Write files
      const files: [string, string][] = [
        ["config.yml", CONFIG_YML],
        ["triage.yml", TRIAGE_YML],
        ["rules.md", RULES_MD],
        ["patterns.json", PATTERNS_JSON],
        [".gitignore", GITIGNORE],
      ];

      for (const [name, content] of files) {
        const filePath = join(preflightDir, name);
        if (existsSync(filePath) && !force) {
          skipped.push(name);
        } else {
          writeFileSync(filePath, content, "utf-8");
          created.push(name);
        }
      }

      const lines: string[] = [
        `# 🛫 Preflight Config Initialized`,
        "",
        `Directory: \`${preflightDir}\``,
        "",
      ];

      if (created.length > 0) {
        lines.push(`**Created:** ${created.map(f => `\`${f}\``).join(", ")}`);
      }
      if (skipped.length > 0) {
        lines.push(`**Skipped (already exist):** ${skipped.map(f => `\`${f}\``).join(", ")} — use \`force: true\` to overwrite`);
      }

      lines.push(
        "",
        "## Next Steps",
        "1. Edit `config.yml` to set your profile and related projects",
        "2. Customize `triage.yml` with project-specific keywords",
        "3. Add team conventions to `rules.md`",
        "4. Drop API contracts/schemas into `contracts/`",
        "5. Commit `.preflight/` to version control",
        "",
        "Auto-generated correction patterns (from `log_correction`) merge with `patterns.json` at runtime.",
      );

      return { content: [{ type: "text" as const, text: lines.join("\n") }] };
    }
  );
}
