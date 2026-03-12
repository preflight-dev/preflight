# Quickstart Guide

Get preflight running in Claude Code in under 2 minutes.

## 1. Add the MCP server

```bash
claude mcp add preflight -- npx -y preflight-dev-serve
```

That's it. No cloning, no `npm install`. The `npx` shim downloads and runs the server automatically.

### Want project-aware features? (recommended)

Point preflight at your project so it can search session history, extract contracts, and give better triage:

```bash
claude mcp add preflight \
  -e CLAUDE_PROJECT_DIR=/path/to/your/project \
  -- npx -y preflight-dev-serve
```

## 2. Verify it's working

```bash
claude mcp list
```

You should see `preflight` in the output. If not, restart Claude Code and try again.

## 3. Use it

Open Claude Code in your project and try a deliberately vague prompt:

```
fix the bug
```

Preflight will intercept this and ask you to clarify — that's the point. You'll see something like:

```
⚠️ AMBIGUOUS — This prompt is too vague to act on safely.

Missing context:
• Which bug? (file, function, error message)
• Expected vs actual behavior
• Any recent changes that might have caused it?
```

Now try a well-specified prompt:

```
Fix the JWT refresh logic in src/auth/jwt.ts — the token isn't being
refreshed when it expires, causing 401s on the /api/user endpoint.
The expiry check on line 42 compares against seconds but Date.now()
returns milliseconds.
```

Preflight will classify this as **CLEAR** and let it through — no friction for good prompts.

## 4. (Optional) Add project config

Run the init wizard to scaffold a `.preflight/` config directory:

```bash
npx preflight-dev init
```

This creates:

```
.preflight/
├── config.yml      # Profile, related projects, thresholds
├── triage.yml      # Prompt classification keywords
└── contracts/      # (empty — add manual type definitions here)
```

All config is optional — preflight works with zero config. But tuning `triage.yml` to your domain (adding keywords like your service names, domain terms) makes triage significantly better.

## 5. (Optional) Onboard your project

If you have existing Claude Code session history, run the onboard tool to index it for semantic search:

```
Use the onboard_project tool on this project
```

This parses your JSONL session files, extracts types and contracts from your codebase, and builds a LanceDB vector index. First run downloads a ~90MB embedding model (one-time).

After onboarding, you can search across all your past sessions:

```
Search my session history for "auth token refresh"
```

## Key tools to know

| Tool | When to use it |
|------|---------------|
| `preflight_check` | The main entry point — triages any prompt automatically |
| `search_history` | Semantic search across past Claude Code sessions |
| `search_contracts` | Find shared types/interfaces across related projects |
| `generate_scorecard` | Get a 12-category quality score for a session |
| `estimate_cost` | See how many tokens you're burning on corrections |

## Next steps

- Read the [full README](../README.md) for the complete tool reference
- Copy `examples/.preflight/` for a commented starter config
- Check [Troubleshooting](../README.md#troubleshooting) if anything goes wrong
