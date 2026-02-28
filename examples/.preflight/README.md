# `.preflight/` Config Directory

Drop this directory into your project root to customize preflight behavior.

## Files

| File | Purpose |
|------|---------|
| `config.yml` | Profile, related projects, thresholds, embedding provider |
| `triage.yml` | Triage strictness and keyword rules |

## Setup

```bash
cp -r examples/.preflight /path/to/your/project/
```

Edit the YAML files to match your project. All fields are optional — anything you omit uses sensible defaults.

## Tips

- **Commit this directory** to share settings across your team.
- Add domain-specific keywords to `triage.yml` → `always_check` for areas where mistakes are costly (billing, permissions, migrations).
- Add quick commands to `skip` so preflight doesn't slow you down on `commit`, `lint`, etc.
- When working across multiple repos, add them to `related_projects` in `config.yml` for cross-service contract detection.
