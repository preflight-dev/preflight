# `.preflight/` Config Example

Copy this directory into your project root to configure preflight for your team.

```
your-project/
├── .preflight/
│   ├── config.yml          # Main settings: profile, related projects, thresholds
│   ├── triage.yml          # Triage rules: which words trigger which classification
│   └── contracts/
│       └── api.yml         # Manual contract definitions (supplements auto-extraction)
├── src/
└── ...
```

## Getting Started

1. Copy the `.preflight/` directory to your project root
2. Edit `config.yml` — set your `related_projects` paths
3. Edit `triage.yml` — add domain-specific keywords to `always_check`
4. Optionally add contracts in `contracts/*.yml`
5. Commit to your repo — the whole team shares the config

## What Each File Does

| File | Purpose | Required? |
|------|---------|-----------|
| `config.yml` | Profile, related projects, thresholds, embeddings | No (sensible defaults) |
| `triage.yml` | Keyword rules and strictness for prompt classification | No (sensible defaults) |
| `contracts/*.yml` | Manual type/interface definitions for cross-service awareness | No |

All files are optional. Preflight works without any config — these just let you tune it.
