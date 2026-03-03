# Example `.preflight/` Configuration

Copy this directory into your project root to configure preflight for your team.

```bash
cp -r examples/.preflight /path/to/your/project/
```

## Files

| File | Purpose |
|------|---------|
| `config.yml` | Main config — profile, related projects, thresholds, embedding provider |
| `triage.yml` | Triage rules — which keywords trigger which classification level |
| `contracts/*.yml` | Manual contract definitions that supplement auto-extraction |

## What to customize

1. **`config.yml`** — Update `related_projects` paths to point at your actual services
2. **`triage.yml`** — Add your domain keywords to `always_check` (e.g. `billing`, `payment`, `deploy`)
3. **`contracts/`** — Add shared types that preflight should always surface

## Commit it

The `.preflight/` directory is meant to be committed to your repo. The whole team benefits from shared triage rules and contract definitions.

Environment variables (`CLAUDE_PROJECT_DIR`, `OPENAI_API_KEY`, etc.) are per-user overrides — they take lower precedence than these files.
