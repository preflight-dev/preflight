#!/usr/bin/env node
// Preflight CLI entry point
// - `preflight-dev` (no args)  → starts the MCP server
// - `preflight-dev init`       → runs interactive setup wizard
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const command = process.argv[2];

if (command === 'init') {
  const initPath = join(__dirname, '../dist/cli/init.js');
  await import(initPath);
} else if (command === 'help' || command === '--help' || command === '-h') {
  console.log(`
✈️  preflight-dev — MCP server for Claude Code prompt discipline

Usage:
  preflight-dev           Start the MCP server (default)
  preflight-dev init      Interactive setup wizard — creates .mcp.json and .preflight/
  preflight-dev help      Show this help message

Environment variables:
  CLAUDE_PROJECT_DIR            Project root for timeline/contract tools (required for full profile)
  PROMPT_DISCIPLINE_PROFILE     Tool profile: minimal | standard | full (default: standard)
  EMBEDDING_PROVIDER            Embedding backend: local | openai (default: local)
  OPENAI_API_KEY                Required if EMBEDDING_PROVIDER=openai

Quick start:
  claude mcp add preflight -- npx -y preflight-dev@latest
`);
} else {
  // Default: start MCP server
  const serverPath = join(__dirname, '../dist/index.js');
  await import(serverPath);
}
