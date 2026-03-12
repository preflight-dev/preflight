# Troubleshooting

Common issues and fixes for preflight.

---

## LanceDB / Native Module Errors

**Symptom:** `Error: Failed to load native module` or `Cannot find module @lancedb/lancedb-...` on startup.

LanceDB uses platform-specific native binaries (NAPI). If the binary for your OS/arch wasn't downloaded during install, it won't load.

**Fixes:**

1. **Re-install with a clean cache:**
   ```bash
   rm -rf node_modules
   npm install
   ```

2. **Check your platform is supported.** LanceDB ships binaries for:
   - macOS: `aarch64-apple-darwin` (Apple Silicon), `x86_64-apple-darwin` (Intel)
   - Linux: `x86_64` and `aarch64` (glibc and musl)
   - Windows: `x86_64` and `aarch64` (MSVC)

   If you're on an unsupported platform (e.g., 32-bit Linux, FreeBSD), LanceDB won't work. Open an issue.

3. **Docker / CI:** Make sure `npm install` runs on the same architecture as your runtime. If you build on x86 and run on ARM (or vice versa), the native module won't match. Use `--platform` in Docker or install inside the container.

4. **Node version:** Requires Node 18+. Older versions may fail to load the NAPI binaries.

---

## Embedding Model Downloads Are Slow / Fail

**Symptom:** First run hangs or times out when preflight tries to generate embeddings.

The default `local` embedding provider uses `@xenova/transformers` which downloads the `all-MiniLM-L6-v2` model (~23MB) on first use. This can be slow on restricted networks.

**Fixes:**

1. **Wait it out.** The first run downloads the model to `~/.cache/xenova/`. Subsequent runs are instant.

2. **Use OpenAI embeddings instead** (faster, but needs an API key):
   ```yaml
   # .preflight/config.yml
   embeddings:
     provider: openai
     # Set OPENAI_API_KEY in your environment
   ```

3. **Proxy / firewall:** If you're behind a corporate proxy, set `HTTPS_PROXY` so the model can download:
   ```bash
   HTTPS_PROXY=http://proxy:8080 npx preflight-dev-serve
   ```

4. **Pre-download the model** on a machine with internet access, then copy `~/.cache/xenova/` to the target machine.

---

## `npx preflight-dev-serve` Not Found or Wrong Version

**Symptom:** `npx: command not found` or `preflight-dev-serve: not found` or you get an old version.

**Fixes:**

1. **Clear the npx cache:**
   ```bash
   npx --yes clear-npx-cache
   npx -y preflight-dev-serve
   ```

2. **Pin the version** if npx is pulling something stale:
   ```bash
   npx -y preflight-dev-serve@latest
   ```

3. **Install globally** to avoid npx issues entirely:
   ```bash
   npm install -g preflight-dev
   preflight-dev-serve
   ```

---

## MCP Server Not Connecting to Claude Code

**Symptom:** You added the MCP config but Claude Code doesn't see preflight tools.

**Fixes:**

1. **Restart Claude Code** after adding the MCP server config. MCP servers are loaded at startup.

2. **Check your `.mcp.json` syntax.** A trailing comma or missing quote breaks JSON silently:
   ```bash
   cat .mcp.json | python3 -m json.tool
   ```

3. **Verify the server starts manually:**
   ```bash
   npx -y preflight-dev-serve
   # Should print: "Preflight MCP server running on stdio"
   ```
   If it errors here, fix that first (see sections above).

4. **Path issues with `node`:** If Claude Code uses a different Node than your shell, the MCP server might fail silently. Set the full path:
   ```json
   {
     "mcpServers": {
       "preflight": {
         "command": "/usr/local/bin/node",
         "args": ["/path/to/preflight/dist/serve.js"]
       }
     }
   }
   ```

---

## `.preflight/` Config Not Being Picked Up

**Symptom:** You created `.preflight/config.yml` but preflight ignores your settings.

**Fixes:**

1. **Check the directory is in your project root** — the same directory where `.mcp.json` lives.

2. **Set `CLAUDE_PROJECT_DIR`** if preflight can't find your project:
   ```bash
   claude mcp add preflight \
     -e CLAUDE_PROJECT_DIR=/path/to/your/project \
     -- npx -y preflight-dev-serve
   ```

3. **YAML syntax:** Validate your config:
   ```bash
   python3 -c "import yaml; yaml.safe_load(open('.preflight/config.yml'))"
   ```

---

## Semantic Search Returns No Results

**Symptom:** `search_timeline` or `search_corrections` returns empty even though you have session history.

**Fixes:**

1. **Index your project first:**
   ```
   Use the `onboard_project` tool in Claude Code, or run:
   preflight index /path/to/project
   ```
   Preflight needs to ingest your JSONL session files before search works.

2. **Check the data directory exists:**
   ```bash
   ls ~/.preflight/projects/
   ```
   If empty, nothing has been indexed yet.

3. **Wrong project directory:** Preflight hashes the absolute path to identify projects. If you moved your project or use symlinks, re-index.

---

## High Memory Usage

**Symptom:** Node process uses 500MB+ RAM.

The local embedding model (`@xenova/transformers`) loads into memory. This is normal for the first session but shouldn't grow further.

**Fixes:**

1. **Switch to OpenAI embeddings** — offloads embedding computation to the API, reducing local memory to ~50MB.

2. **Limit search scope** — use `since` and project filters in `search_timeline` to avoid scanning large indices.

---

## Still Stuck?

- Check [GitHub Issues](https://github.com/TerminalGravity/preflight/issues) — someone may have hit the same problem.
- Open a new issue with your OS, Node version (`node -v`), and the full error message.
