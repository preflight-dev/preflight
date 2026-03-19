# Troubleshooting

Common issues and fixes for preflight.

---

## Installation & Setup

### `npx preflight-dev-serve` fails with module errors

**Symptoms:** `ERR_MODULE_NOT_FOUND` or `Cannot find module` when running via npx.

**Fix:** Preflight requires **Node 20+**. Check your version:
```bash
node --version
```
If you're on Node 18 or below, upgrade via [nvm](https://github.com/nvm-sh/nvm):
```bash
nvm install 20
nvm use 20
```

### Tools don't appear in Claude Code after `claude mcp add`

**Fix:** Restart Claude Code completely after adding the MCP server. The tool list is loaded at startup.

If tools still don't appear, verify the server starts without errors:
```bash
npx preflight-dev-serve
```
You should see MCP protocol output (JSON on stdout). If you see errors, check the sections below.

---

## LanceDB & Timeline Search

### `Error: Failed to open LanceDB` or LanceDB crashes on startup

**Symptoms:** Timeline tools (`search_timeline`, `index_sessions`, etc.) fail. Other tools work fine.

**Cause:** LanceDB uses native binaries that may not be available for your platform, or the database directory has permission issues.

**Fixes:**
1. Make sure `~/.preflight/projects/` is writable:
   ```bash
   mkdir -p ~/.preflight/projects
   ls -la ~/.preflight/
   ```
2. If on an unsupported platform, use the **minimal** or **standard** profile (no LanceDB required):
   ```bash
   npx preflight-dev
   # Choose "minimal" or "standard" when prompted
   ```
3. Clear corrupted LanceDB data:
   ```bash
   rm -rf ~/.preflight/projects/*/timeline.lance
   ```
   Then re-index with `index_sessions`.

### Timeline search returns no results

**Cause:** Sessions haven't been indexed yet. Preflight doesn't auto-index — you need to run `index_sessions` first.

**Fix:** In Claude Code, run:
```
index my sessions
```
Or use the `index_sessions` tool directly. Indexing reads your `~/.claude/projects/` session files.

---

## Embeddings

### `OpenAI API key required for openai embedding provider`

**Cause:** You selected OpenAI embeddings but didn't set the API key.

**Fixes:**

Option A — Set the environment variable when adding the MCP server:
```bash
claude mcp add preflight \
  -e OPENAI_API_KEY=sk-... \
  -- npx -y preflight-dev-serve
```

Option B — Switch to local embeddings (no API key needed). Create or edit `~/.preflight/config.json`:
```json
{
  "embedding_provider": "local",
  "embedding_model": "Xenova/all-MiniLM-L6-v2"
}
```

### Local embeddings are slow on first run

**Expected.** The model (~80MB) downloads on first use and is cached afterward. Subsequent runs are fast.

---

## `.preflight/` Config

### `warning - failed to parse .preflight/config.yml`

**Cause:** YAML syntax error in your project's `.preflight/config.yml`.

**Fix:** Validate your YAML:
```bash
npx yaml-lint .preflight/config.yml
```
Or check for common issues: wrong indentation, tabs instead of spaces, missing colons.

### Config changes not taking effect

**Cause:** Preflight reads config at MCP server startup, not on every tool call.

**Fix:** Restart Claude Code after editing `.preflight/config.yml` or `.preflight/triage.yml`.

---

## Profiles

### Which profile should I use?

| Profile | Tools | Best for |
|---------|-------|----------|
| **minimal** | 4 | Try it out, low overhead |
| **standard** | 16 | Daily use, no vector search needed |
| **full** | 20 | Power users who want timeline search |

You can change profiles by re-running the setup wizard:
```bash
npx preflight-dev
```

---

## Platform-Specific

### Apple Silicon (M1/M2/M3/M4): LanceDB build fails

LanceDB ships prebuilt binaries for Apple Silicon. If `npm install` fails on the native module:
```bash
# Ensure you're using the ARM64 version of Node
node -p process.arch   # should print "arm64"

# If it prints "x64", reinstall Node natively (not via Rosetta)
```

### Linux: Permission denied on `~/.preflight/`

```bash
chmod -R u+rwX ~/.preflight/
```

---

## Still stuck?

1. Check [open issues](https://github.com/TerminalGravity/preflight/issues) — someone may have hit the same problem
2. [Open a new issue](https://github.com/TerminalGravity/preflight/issues/new) with:
   - Your Node version (`node --version`)
   - Your OS and architecture (`uname -a`)
   - The full error message
   - Which profile you selected
