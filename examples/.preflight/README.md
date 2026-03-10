# Example `.preflight/` Config

Copy this directory into your project root to get started:

```bash
cp -r examples/.preflight /path/to/your/project/
```

Then edit the files to match your project:

| File | Purpose |
|------|---------|
| `config.yml` | Profile, related projects, thresholds, embedding provider |
| `triage.yml` | Keyword rules and strictness for prompt classification |
| `contracts/*.yml` | Manual type/interface definitions for cross-service awareness |

All files are optional — preflight works without any config. These let you tune it for your team and codebase.

## Tips

- **Commit `.preflight/` to your repo** so the whole team shares the same rules
- **Start with `strictness: standard`**, then relax or tighten based on your experience
- **Add domain terms to `always_check`** that are frequently ambiguous in your codebase (e.g., "billing", "permissions")
- **Use contracts** for types that live in a separate repo or aren't auto-detected
