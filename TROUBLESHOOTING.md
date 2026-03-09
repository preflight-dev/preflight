# Troubleshooting

Common issues and how to fix them.

---

## Server won't start

**Symptom:** `claude mcp add` succeeds but tools don't appear, or you see errors in Claude Code's MCP log.

**Fixes:**

1. **Check Node version.** Preflight requires Node 20+.
   ```bash
   node --version  # Must be v20.x or higher
   ```

2. **Missing dependencies.** If running from a clone:
   ```bash
   cd /path/to/preflight && npm install
   ```

3. **Wrong path.** The `tsx` command needs the path to `src/index.ts` (dev) or use the npm binary:
   ```bash
   # From source
   claude mcp add preflight -- npx tsx /absolute/path/to/preflight/src/index.ts

   # From npm
   npm install -g preflight-dev
   claude mcp add preflight -- preflight-dev
   ```

4. **Restart Claude Code** after adding or changing MCP config. Tools won't appear until restart.

---

## "No projects found" on search/timeline

**Symptom:** `search_history` or `timeline_view` returns "No projects found for scope."

**Cause:** `CLAUDE_PROJECT_DIR` isn't set, and no projects have been onboarded.

**Fix:** Set the env var in your `.mcp.json`:

```json
{
  "mcpServers": {
    "preflight": {
      "command": "npx",
      "args": ["tsx", "/path/to/preflight/src/index.ts"],
      "env": {
        "CLAUDE_PROJECT_DIR": "/path/to/your/project"
      }
    }
  }
}
```

Or run the `onboard_project` tool first to register a project.

---

## LanceDB / vector search errors

**Symptom:** Errors mentioning LanceDB, `@lancedb/lancedb`, or embeddings when using `search_history`.

**Fixes:**

1. **Native dependency build.** LanceDB includes native code. If `npm install` fails on your platform:
   ```bash
   # Make sure you have build tools
   # macOS:
   xcode-select --install
   # Linux:
   sudo apt install build-essential python3
   ```

2. **First-time indexing.** The timeline DB is created on first use. Run `onboard_project` to trigger initial indexing — this may take a moment for large session histories.

3. **Disk space.** LanceDB stores vectors in `~/.preflight/timeline/`. Check disk space if indexing fails silently.

---

## Embedding provider issues

**Symptom:** Search returns no results or poor matches.

**Default behavior:** Preflight uses a local embedding provider (no API key needed). For better quality, you can use OpenAI:

```bash
claude mcp add preflight \
  -e EMBEDDING_PROVIDER=openai \
  -e OPENAI_API_KEY=sk-... \
  -- npx tsx /path/to/preflight/src/index.ts
```

Or set in `.preflight/config.yml`:

```yaml
embeddings:
  provider: openai
  model: text-embedding-3-small
```

---

## Tools appear but do nothing

**Symptom:** Tools are listed but `preflight_check` returns empty or generic responses.

**Likely cause:** The project directory doesn't have meaningful git history or session data yet.

**What to try:**

1. Make sure you're in a git repo with commits.
2. Use `preflight_check` with a real prompt — it needs actual text to triage.
3. Run `session_stats` to verify session data is accessible.

---

## `.preflight/` config not loading

**Symptom:** Custom triage rules or thresholds in `.preflight/config.yml` are ignored.

**Fixes:**

1. The `.preflight/` directory must be in your **project root** (where `CLAUDE_PROJECT_DIR` points).
2. File must be valid YAML. Validate with:
   ```bash
   npx yaml < .preflight/config.yml
   ```
3. Check the [config example](/.preflight/) in this repo for correct structure.

---

## High token usage from preflight itself

**Symptom:** Preflight tools are consuming lots of tokens with long outputs.

**Fix:** Switch to the `minimal` profile:

```bash
claude mcp add preflight \
  -e PROMPT_DISCIPLINE_PROFILE=minimal \
  -- npx tsx /path/to/preflight/src/index.ts
```

Profiles: `strict` (most checks), `standard` (default), `minimal` (lightweight).

---

## Init wizard launches instead of MCP server

**Symptom:** Running `preflight-dev` via `claude mcp add` opens the interactive setup wizard instead of starting the MCP server.

**Cause:** Older versions of the bin entry always ran the init wizard regardless of context.

**Fix:** Update to the latest version and use `serve` to force server mode:

```bash
npm install -g preflight-dev@latest
claude mcp add preflight -- preflight-dev serve
```

The binary auto-detects TTY vs piped stdin, but `serve` makes it explicit. You can also force the wizard with `preflight-dev init`.

---

## Still stuck?

- Check [GitHub Issues](https://github.com/TerminalGravity/preflight/issues) for known bugs
- Open a new issue with your Node version, OS, and the error message
