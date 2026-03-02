#!/usr/bin/env node
// MCP server entry point — loads the compiled index
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const serverPath = join(__dirname, '../dist/index.js');
await import(serverPath);
