# `.preflight/` Configuration

Copy this directory into your project root to configure preflight per-project.

```
your-project/
├── .preflight/
│   ├── config.yml    # Profile, thresholds, embeddings, related projects
│   └── triage.yml    # Triage rules and strictness
├── src/
└── ...
```

## Quick setup

```bash
# From your project root:
cp -r /path/to/preflight/examples/.preflight .preflight
# Edit to taste, then commit — your whole team gets the same config.
```

## How it works

- **Without `.preflight/`**: preflight uses environment variables (`PROMPT_DISCIPLINE_PROFILE`, `PREFLIGHT_RELATED`, etc.)
- **With `.preflight/`**: YAML config takes precedence over env vars
- All fields are optional — omitted values use sensible defaults

## Files

| File | Purpose |
|------|---------|
| `config.yml` | Profile level, related projects, thresholds, embedding provider |
| `triage.yml` | Triage strictness and keyword rules (always_check, skip, cross_service) |

## Team sharing

Commit `.preflight/` to your repo. Everyone on the team gets the same triage rules and thresholds — no per-developer env var setup needed.
