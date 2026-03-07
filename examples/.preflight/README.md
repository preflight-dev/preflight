# Example `.preflight/` Configuration

Copy this directory to your project root to get started:

```bash
cp -r examples/.preflight /path/to/your/project/
```

Then edit the files for your project:

1. **`config.yml`** — Set your related projects and thresholds
2. **`triage.yml`** — Add domain-specific keywords that should trigger checks
3. **`contracts/*.yml`** — Define shared types and API contracts

All fields are optional. Preflight uses sensible defaults for anything you leave out.

## File Overview

```
.preflight/
├── config.yml          # Main config: related projects, thresholds, embeddings
├── triage.yml          # Triage rules: which prompts get checked and how
├── contracts/
│   └── api.yml         # Manual contract definitions (types, interfaces, routes)
└── README.md           # This file (you can delete it)
```

## Tips

- **Commit `.preflight/` to your repo** so your whole team gets the same behavior
- **Start with defaults** and add `always_check` keywords as you discover pain points
- **Split contracts** into multiple files (`api.yml`, `events.yml`, etc.) for organization
- **Use `profile: minimal`** if preflight feels too chatty during rapid iteration
