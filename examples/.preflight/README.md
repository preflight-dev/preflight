# `.preflight/` Configuration

Drop this directory into your project root to customize preflight behavior.

## Files

| File | Purpose |
|------|---------|
| `config.yml` | Profile, related projects, thresholds, embedding provider |
| `triage.yml` | Prompt classification rules and strictness |

## Quick Setup

```bash
# From your project root:
cp -r /path/to/preflight/examples/.preflight .preflight
```

Edit the files to match your project. All fields are optional — anything you omit uses sensible defaults.

## Commit It

`.preflight/` is designed to be checked into version control. Your whole team gets the same triage rules, thresholds, and cross-service awareness without any per-developer setup.

## Environment Variable Fallback

If no `.preflight/` directory exists, preflight falls back to environment variables:

| Env Var | Maps to |
|---------|---------|
| `PROMPT_DISCIPLINE_PROFILE` | `profile` in config.yml |
| `PREFLIGHT_RELATED` | `related_projects` (comma-separated paths) |
| `EMBEDDING_PROVIDER` | `embeddings.provider` in config.yml |
| `OPENAI_API_KEY` | `embeddings.openai_api_key` in config.yml |

When `.preflight/` exists, env vars are ignored (config files take precedence).
