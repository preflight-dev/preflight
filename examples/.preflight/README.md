# Example `.preflight/` Configuration

Copy this entire `.preflight/` directory into your project root to get started.

```bash
cp -r examples/.preflight /path/to/your/project/
```

Then edit the files to match your project:

## Files

| File | Purpose |
|------|---------|
| `config.yml` | Main configuration — profile, related projects, thresholds |
| `triage.yml` | Controls how prompts are classified (trivial/ambiguous/cross-service) |
| `contracts/api.yml` | Example manual contract definitions for cross-service awareness |

## What to customize

1. **`config.yml`** — Update `related_projects` paths to point at your actual sibling services
2. **`triage.yml`** — Add domain-specific keywords to `always_check` (e.g., your core business objects) and `skip` (e.g., your safe routine commands)
3. **`contracts/`** — Add YAML files for shared types/interfaces that span multiple services

## Committing to your repo

These files are designed to be committed — they help your whole team get consistent preflight behavior. Add them to version control:

```bash
git add .preflight/
git commit -m "add preflight config"
```
