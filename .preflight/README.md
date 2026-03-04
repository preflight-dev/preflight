# `.preflight/` Configuration

This directory contains example configuration files for preflight. Copy the `.example` files to get started:

```bash
cp .preflight/config.yml.example .preflight/config.yml
cp .preflight/triage.yml.example .preflight/triage.yml
mkdir -p .preflight/contracts
cp .preflight/contracts/api.yml.example .preflight/contracts/api.yml
```

## Files

| File | Purpose |
|------|---------|
| `config.yml` | Main config — verbosity profile, related projects, thresholds, embedding provider |
| `triage.yml` | Triage rules — keywords that control how prompts are classified |
| `contracts/*.yml` | Manual API contract definitions that supplement auto-extraction |

## Tips

- **Commit these files** to share settings across your team
- All fields are optional — defaults are sensible
- Environment variables (`CLAUDE_PROJECT_DIR`, `OPENAI_API_KEY`, etc.) are fallbacks; config files take precedence
- Add project-specific keywords to `triage.yml` — e.g., if `billing` is always complex in your codebase, add it to `always_check`
