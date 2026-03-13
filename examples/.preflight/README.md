# `.preflight/` Configuration Example

Copy this directory into your project root to customize preflight behavior.

```bash
cp -r examples/.preflight /path/to/your/project/
```

## Files

| File | Purpose |
|------|---------|
| `config.yml` | Profile, related projects, thresholds, embedding settings |
| `triage.yml` | Triage strictness, skip/always-check/cross-service keyword lists |

## Quick Setup

**Minimal (just want it quieter):**
```yaml
# config.yml
profile: minimal
```

**Strict (payments/healthcare — force clarity on everything):**
```yaml
# config.yml
profile: full

# triage.yml
strictness: strict
rules:
  always_check: [payments, patient, hipaa, pii, migration, deploy]
```

**Monorepo with related services:**
```yaml
# config.yml
related_projects:
  - path: ../api-gateway
    alias: gateway
  - path: ../shared-types
    alias: types
  - path: ../worker-service
    alias: worker
```

## Notes

- When `.preflight/` exists, environment variables (`PROMPT_DISCIPLINE_PROFILE`, etc.) are ignored
- All fields are optional — omitted values use sensible defaults
- Commit this directory to share settings across your team
