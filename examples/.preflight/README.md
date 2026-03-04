# Example `.preflight/` Configuration

Copy this directory into your project root:

```bash
cp -r examples/.preflight /path/to/your/project/
```

Then edit the files to match your setup:

- **`config.yml`** — Profile, related projects, thresholds, embedding provider
- **`triage.yml`** — Which keywords trigger which triage levels
- **`contracts/api.yml`** — Manual API contract definitions (supplements auto-extraction)

All files are optional. Preflight works with sensible defaults out of the box.

## Quick Customization

**Want stricter triage?** Set `strictness: strict` in `triage.yml`.

**Have microservices?** Uncomment `related_projects` in `config.yml` and add your service paths.

**Using OpenAI embeddings?** Set `embeddings.provider: openai` and add your key in `config.yml`.

**Custom contracts?** Add more YAML files to `contracts/` — they'll be merged automatically.
