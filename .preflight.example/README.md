# `.preflight/` Example Config

Copy this directory into your project root as `.preflight/`:

```bash
cp -r .preflight.example /path/to/your/project/.preflight
```

Then customize for your project:

1. **`config.yml`** — Set your profile, related projects, and thresholds
2. **`triage.yml`** — Add domain-specific keywords that control how prompts are classified
3. **`contracts/*.yml`** — Define key types/interfaces preflight should know about

All files are optional. Preflight uses sensible defaults for anything you don't configure.

## Quick Setup

Most projects only need `config.yml` with related projects:

```yaml
# .preflight/config.yml
profile: standard
related_projects:
  - path: /path/to/your/api
    alias: api
  - path: /path/to/your/shared-types
    alias: types
```

## Tips

- **Commit `.preflight/`** to your repo so your whole team benefits
- **Add to `triage.yml`** when you notice preflight missing domain-specific ambiguity
- **Add contracts** for types that span multiple services — this is where cross-service checks shine
- **Start with `standard`** strictness and adjust based on your team's experience level
