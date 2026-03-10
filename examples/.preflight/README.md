# `.preflight/` Config Directory

Copy this directory to your project root to configure preflight for your team.

```
your-project/
├── .preflight/
│   ├── config.yml          # Main config (profile, thresholds, related projects)
│   ├── triage.yml          # Triage rules (keywords, strictness)
│   └── contracts/          # Manual contract definitions
│       └── api.yml         # Example: shared API types and routes
├── src/
└── ...
```

## Getting Started

```bash
# From your project root:
cp -r /path/to/preflight/examples/.preflight .preflight

# Edit config.yml with your related project paths:
vim .preflight/config.yml

# Commit to share with your team:
git add .preflight && git commit -m "add preflight config"
```

## Files

| File | Purpose | Required? |
|------|---------|-----------|
| `config.yml` | Profile, related projects, thresholds, embedding config | No (sensible defaults) |
| `triage.yml` | Keyword rules and strictness for prompt classification | No (sensible defaults) |
| `contracts/*.yml` | Manual type/route/interface definitions | No (auto-extracted from code) |

All files are optional. Preflight works with zero config — these files let you tune it.

## Tips

- **Start minimal.** Drop in just `config.yml` with your `related_projects`. Add triage rules later as you see which prompts get misclassified.
- **Contracts are supplements.** Preflight auto-extracts types and routes from your code. Only add manual contracts for external services or planned interfaces.
- **Commit `.preflight/`.** The whole point is team-shareable configuration.
