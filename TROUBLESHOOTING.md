# Troubleshooting

Common issues and fixes for preflight.

---

## Installation

### `npm install` fails with LanceDB native binary errors

LanceDB uses native binaries. If you see errors like `prebuild-install WARN` or `node-gyp` failures:

```
npm ERR! @lancedb/lancedb@0.26.2: The platform "linux" is incompatible
```

**Fix:** Make sure you're on a supported platform (macOS arm64/x64, Linux x64, Windows x64) and Node >= 20:

```bash
node -v  # must be >= 20
npm cache clean --force
rm -rf node_modules package-lock.json
npm install
```

If you're on an unsupported platform (e.g., Linux arm64), LanceDB won't work. The timeline/vector search tools will be unavailable, but the core preflight tools still function.

### `npx tsx` not found

```bash
npm install -g tsx
# or use npx (comes with npm 7+):
npx tsx src/index.ts
```

---

## Configuration

### Tools load but `CLAUDE_PROJECT_DIR` warnings appear

The timeline and contract search tools need `CLAUDE_PROJECT_DIR` to know which project to index. Without it, those tools will error on use.

**Fix — Claude Code CLI:**
```bash
claude mcp add preflight \
  -e CLAUDE_PROJECT_DIR=/absolute/path/to/your/project \
  -- npx tsx /path/to/preflight/src/index.ts
```

**Fix — `.mcp.json`:**
```json
{
  "mcpServers": {
    "preflight": {
      "command": "npx",
      "args": ["tsx", "/path/to/preflight/src/index.ts"],
      "env": {
        "CLAUDE_PROJECT_DIR": "/absolute/path/to/your/project"
      }
    }
  }
}
```

Use absolute paths — relative paths resolve from the MCP server's cwd, which may not be your project.

### `.preflight/` config not being picked up

Preflight looks for `.preflight/config.yml` in `CLAUDE_PROJECT_DIR`. If it's not found, defaults are used silently.

**Check:**
1. File is named exactly `config.yml` (not `config.yaml`)
2. It's inside `.preflight/` at your project root
3. `CLAUDE_PROJECT_DIR` points to the right directory

---

## Runtime

### "Server started" but no tools appear in Claude Code

The MCP handshake might be failing silently.

**Debug steps:**
1. Test the server standalone: `npx tsx src/index.ts` — should print `preflight: server started`
2. Check Claude Code's MCP logs: `claude mcp list` to see registered servers
3. Remove and re-add: `claude mcp remove preflight && claude mcp add preflight -- npx tsx /path/to/preflight/src/index.ts`

### Vector search returns no results

Timeline search uses LanceDB to index your Claude Code session history (JSONL files).

**Common causes:**
- No session history exists yet — use Claude Code for a few sessions first
- `CLAUDE_PROJECT_DIR` not set (search doesn't know where to look)
- Session files are in a non-standard location

**Where Claude Code stores sessions:** `~/.claude/projects/` with JSONL files per session.

### `preflight_check` returns generic advice

The triage system works best with specific prompts. If you're testing with something like "do stuff", the response will be generic by design — that's it telling you the prompt is too vague.

Try a real prompt: `"add rate limiting to the /api/users endpoint"` — you'll see it route through scope analysis, contract search, and produce actionable guidance.

---

## Performance

### Slow startup (>5 seconds)

LanceDB initialization can be slow on first run as it builds the vector index.

**Fix:** Subsequent runs are faster. If consistently slow, check that `node_modules/@lancedb` isn't corrupted:
```bash
rm -rf node_modules/@lancedb
npm install
```

### High memory usage

Each indexed project maintains an in-memory vector index. If you're indexing many large projects, memory can grow.

**Fix:** Only set `CLAUDE_PROJECT_DIR` to the project you're actively working on.

---

## Still stuck?

Open an issue: https://github.com/TerminalGravity/preflight/issues
