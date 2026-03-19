# Examples

## `.preflight/` Config Directory

The `.preflight/` directory contains example configuration files you can copy into your project root:

```
.preflight/
├── config.yml              # Main config — profile, related projects, thresholds
├── triage.yml              # Triage rules — keywords, strictness
└── contracts/
    └── api.yml             # Manual contract definitions for cross-service types
```

## `CLAUDE.md` Integration

The `CLAUDE.md` file tells Claude Code how to behave in your project. Adding preflight rules here makes Claude automatically use preflight tools without you having to ask.

```bash
# Copy the example into your project:
cp /path/to/preflight/examples/CLAUDE.md my-project/CLAUDE.md

# Or append to your existing CLAUDE.md:
cat /path/to/preflight/examples/CLAUDE.md >> my-project/CLAUDE.md
```

This is the **recommended way** to integrate preflight — once it's in your `CLAUDE.md`, every session automatically runs `preflight_check` on your prompts.

---

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
