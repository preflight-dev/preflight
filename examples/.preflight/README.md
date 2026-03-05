# `.preflight/` Configuration

This directory customizes how preflight behaves in your project.

## Setup

Copy this entire directory to your project root:

```bash
cp -r examples/.preflight /path/to/your/project/
```

Make sure `CLAUDE_PROJECT_DIR` points to your project (so preflight knows where to look).

## Files

| File | Purpose |
|------|---------|
| `config.yml` | Profile, related projects, thresholds, embedding provider |
| `triage.yml` | Triage strictness, always-check/skip keywords, cross-service triggers |

Both files are optional. Omit either one (or any field within) and defaults apply.

## Team Sharing

Commit `.preflight/` to your repo so the whole team gets the same triage rules. This is especially useful for:

- Enforcing checks on risky areas (`always_check: [migration, billing]`)
- Skipping noisy checks on safe commands (`skip: [commit, lint]`)
- Cross-service awareness when your project depends on sibling repos

## Environment Variable Fallback

If `.preflight/` doesn't exist, preflight falls back to environment variables:

| Env Var | Maps to |
|---------|---------|
| `PROMPT_DISCIPLINE_PROFILE` | `profile` |
| `PREFLIGHT_RELATED` | `related_projects` (comma-separated paths) |
| `EMBEDDING_PROVIDER` | `embeddings.provider` |
| `OPENAI_API_KEY` | `embeddings.openai_api_key` |

When `.preflight/` exists, env vars are ignored (config files take precedence).
