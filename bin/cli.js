#!/usr/bin/env node
// Dual-mode entry point:
//   - Interactive TTY  → run the init wizard (preflight-dev init)
//   - Piped / non-TTY  → start the MCP server (used by `claude mcp add`)
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const forceInit = process.argv.includes('init');
const forceServe = process.argv.includes('serve');

if (forceInit || (!forceServe && process.stdin.isTTY)) {
  // Interactive: run setup wizard
  const cliPath = join(__dirname, '../dist/cli/init.js');
  await import(cliPath);
} else {
  // Non-interactive (MCP stdio): start the server
  const serverPath = join(__dirname, '../dist/index.js');
  await import(serverPath);
}