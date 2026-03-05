# `.preflight/` — Project Configuration

This directory contains example configuration files for preflight. Copy it to your project root and customize.

## Files

| File | Purpose |
|------|---------|
| `config.yml` | Main config — profile, related projects, thresholds, embeddings |
| `triage.yml` | Triage rules — keywords that control prompt classification |
| `contracts/*.yml` | Manual contract definitions that supplement auto-extraction |

## Quick Setup

```bash
# Copy the example config to your project
cp -r /path/to/preflight/.preflight /path/to/your/project/

# Edit to match your setup
$EDITOR your-project/.preflight/config.yml
```

## Notes

- All fields are optional — defaults are sensible
- `.preflight/` config takes precedence over environment variables
- Commit this directory to share settings across your team
- See the main [README](../README.md#configuration-reference) for full docs
