# Examples

## [Workflow Examples](WORKFLOWS.md)

Concrete before/after examples showing preflight in action — vague bug fixes, multi-step refactors, pattern warnings, session recovery, and more. Start here if you want to see what preflight actually does.

---

## `.preflight/` Config Directory

The `.preflight/` directory contains example configuration files you can copy into your project root:

```
.preflight/
├── config.yml              # Main config — profile, related projects, thresholds
├── triage.yml              # Triage rules — keywords, strictness
└── contracts/
    └── api.yml             # Manual contract definitions for cross-service types
```

### Quick setup

```bash
# From your project root:
cp -r /path/to/preflight/examples/.preflight .preflight

# Edit paths in config.yml to match your setup:
$EDITOR .preflight/config.yml
```

Then commit `.preflight/` to your repo — your whole team gets the same preflight behavior.

### What each file does

| File | Purpose | Required? |
|------|---------|-----------|
| `config.yml` | Profile, related projects, thresholds, embedding config | No — sensible defaults |
| `triage.yml` | Keyword rules for prompt classification | No — sensible defaults |
| `contracts/*.yml` | Manual type/interface definitions for cross-service awareness | No — auto-extraction works without it |

All files are optional. Preflight works out of the box with zero config — these files let you tune it to your codebase.
