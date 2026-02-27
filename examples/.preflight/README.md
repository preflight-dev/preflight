# `.preflight/` Example Config

Copy this directory into your project root to configure preflight:

```bash
cp -r examples/.preflight /path/to/your/project/
```

## Files

| File | Purpose |
|------|---------|
| `config.yml` | Main config — profile, related projects, thresholds, embeddings |
| `triage.yml` | Triage rules — which keywords trigger which classification level |
| `contracts/*.yml` | Manual contract definitions — supplement auto-extraction |

## Quick Setup

1. Copy the directory: `cp -r examples/.preflight ./`
2. Edit `config.yml` — set your `related_projects` paths
3. Edit `triage.yml` — add your domain-specific keywords to `always_check`
4. Optionally add contracts in `contracts/` for planned or external APIs
5. Commit `.preflight/` to your repo so your team shares the same config

All fields are optional. Defaults work well out of the box — only customize what you need.
