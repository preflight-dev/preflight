# `.preflight/` Config Directory

Drop this directory into your project root to configure preflight for your team.

## Quick Setup

```bash
# From the preflight repo:
cp -r examples/.preflight /path/to/your/project/

# Or from your project:
cp -r /path/to/preflight/examples/.preflight .
```

## Files

| File | Purpose |
|------|---------|
| `config.yml` | Main config — profile, related projects, thresholds, embeddings |
| `triage.yml` | Triage rules — which prompts to check, skip, or flag as cross-service |
| `contracts/*.yml` | Manual contract definitions — types, interfaces, routes |

## What to customize first

1. **`config.yml`** — Add your `related_projects` if you work across multiple repos
2. **`triage.yml`** — Add domain-specific keywords to `always_check` (your project's tricky terms)
3. **`contracts/`** — Define shared types that preflight should know about

## Commit it

These files are meant to be committed to your repo so the whole team shares the same preflight config. No secrets in here — API keys go in env vars.
