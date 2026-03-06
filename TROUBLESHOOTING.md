# Troubleshooting

Common issues and fixes for preflight.

---

## Installation & Setup

### `npm install` fails with native module errors

LanceDB (`@lancedb/lancedb`) includes native bindings. If install fails:

```bash
# Ensure you're on Node 20+
node -v

# Clear npm cache and retry
rm -rf node_modules package-lock.json
npm install

# On macOS, you may need Xcode command line tools
xcode-select --install
```

**Apple Silicon (M1/M2/M3):** LanceDB ships prebuilt ARM64 binaries. If you see `Error: Cannot find module ... lancedb-darwin-arm64`, make sure you're not running Node under Rosetta — use the native ARM64 build.

### `npx tsx` not found

```bash
# Install tsx globally
npm install -g tsx

# Or use npx explicitly
npx tsx src/index.ts
```

### `CLAUDE_PROJECT_DIR` not set

If tools return empty results or can't find your project:

```bash
# Set it in your .mcp.json env block
"env": {
  "CLAUDE_PROJECT_DIR": "/absolute/path/to/your/project"
}

# Or export before running
export CLAUDE_PROJECT_DIR=/absolute/path/to/your/project
```

Use an **absolute path** — relative paths resolve against the MCP server's cwd, not your project.

---

## Embedding & Indexing

### First run is slow / downloading a large model

On first use of `onboard_project`, the local Xenova embedding model (~90MB) downloads automatically. This is a one-time cost. Subsequent runs use the cached model.

If the download hangs behind a corporate proxy:

```bash
# Set proxy for the model download
export HTTPS_PROXY=http://your-proxy:8080
```

### `onboard_project` finds 0 sessions

Preflight looks for Claude Code session JSONL files at:

```
~/.claude/projects/<encoded-path>/*.jsonl
```

If no sessions exist yet, there's nothing to index — use Claude Code on the project first, then onboard.

**Check manually:**

```bash
ls ~/.claude/projects/
```

Each subdirectory name is a URL-encoded absolute path. Find yours and verify it has `.jsonl` files.

### LanceDB `table not found` or corrupt database

If the LanceDB database gets corrupted (e.g., interrupted indexing):

```bash
# Find your project's data directory
cat ~/.preflight/projects/index.json

# Remove and re-index
rm -rf ~/.preflight/projects/<your-hash>/timeline.lance
# Then run onboard_project again from Claude Code
```

### OpenAI embeddings not working

If you set `OPENAI_API_KEY` but embeddings still use local:

1. Check the key is valid: `echo $OPENAI_API_KEY | head -c 10`
2. Set the provider explicitly in `.preflight/config.yml`:
   ```yaml
   embeddings:
     provider: openai
   ```
3. Or via environment: `export EMBEDDING_PROVIDER=openai`

Config file settings override environment variables.

---

## MCP Connection

### Tools don't appear in Claude Code

After adding to `.mcp.json`, restart Claude Code completely (not just reload). Verify your config:

```bash
claude mcp list
```

You should see `preflight` with its tools listed.

### "Server disconnected" or MCP timeout

Preflight loads embedding models on first tool call, which can take a few seconds. If Claude Code times out:

1. Pre-warm by running `npm run build` in the preflight directory
2. Ensure `node_modules` is fully installed (no missing deps)
3. Try running directly to check for errors:
   ```bash
   npx tsx /path/to/preflight/src/index.ts
   ```
   It should print nothing and wait for MCP input on stdin.

---

## Scoring & Reports

### Scorecard shows all zeros

The scorecard needs indexed session data. Run `onboard_project` first, then `generate_scorecard`.

### PDF export fails

PDF export requires Playwright:

```bash
npx playwright install chromium
```

If you don't need PDF, use `format: "markdown"` instead.

---

## Common Gotchas

### `preflight_check` says everything is "trivial"

Short, command-like prompts (`commit`, `lint`, `format`) are trivial by design. To test triage on ambiguous prompts, try something like `"fix the bug"` or `"update the tests"`.

You can also force a level:

```
preflight_check("fix the auth", { force_level: "full" })
```

### Cross-service search returns nothing

1. Related projects must be onboarded first (`onboard_project` for each)
2. Configure relationships in `.preflight/config.yml`:
   ```yaml
   related_projects:
     - path: /absolute/path/to/other-service
       alias: other-service
   ```
3. Or set `PREFLIGHT_RELATED=/path/to/service1,/path/to/service2`

### Changes to `.preflight/` config not taking effect

Config is loaded when the MCP server starts. Restart Claude Code after changing `.preflight/config.yml` or `triage.yml`.

---

## Still stuck?

[Open an issue](https://github.com/TerminalGravity/preflight/issues) with:
- Node version (`node -v`)
- OS and architecture (`uname -a`)
- The error message or unexpected behavior
- Steps to reproduce
