# Examples

## `CLAUDE.md` — Project Instructions with Preflight

The [`CLAUDE.md`](CLAUDE.md) example shows how to set up your project instructions so Claude Code automatically uses preflight on every prompt. Copy it to your project root and customize:

```bash
cp /path/to/preflight/examples/CLAUDE.md ./CLAUDE.md
```

Key things it demonstrates:
- Telling Claude to run `preflight_check` before starting work
- Documenting your stack, conventions, and fragile areas
- Keeping it under 5KB to avoid token bloat (preflight's `token_audit` will warn you if it gets too big)

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
