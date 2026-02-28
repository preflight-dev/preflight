# Changelog

All notable changes to preflight are documented here.

## [3.2.0] — 2025-05-15

The "unified entry point" release. One tool to rule them all.

### Added
- **`preflight_check`** — single entry point that triages every prompt and chains the right checks automatically
- **Smart triage classification** — routes prompts through a decision tree: trivial → clear → ambiguous → cross-service → multi-step
- **Correction pattern learning** (`check_patterns`, `log_correction`) — remembers past mistakes and warns before you repeat them
- **Cross-service contracts** — extracts types, interfaces, routes, and schemas across related projects
- **`.preflight/` config directory** — team-shareable YAML config for triage rules and thresholds
- **Trend & comparative scorecards** — weekly/monthly trend lines, cross-project comparisons, radar charts, PDF export
- **`estimate_cost`** — estimates token spend and waste from correction cycles
- **Contract integration** in `onboard_project`, `clarify_intent`, and `scope_work`
- **Cross-service awareness** in `enrich_agent_task`
- CI workflow for build, lint, and test
- npm publish workflow on release tags

### Fixed
- False-positive file path matching in `preflight_check` (dotfiles, common words)
- Vague verb detection no longer triggers when prompt has explicit file refs or line numbers

### Improved
- Comprehensive test suite (100+ tests across triage, config, session parser, cost estimation, scorecard scoring)
- ESLint with TypeScript support
- `.editorconfig` for consistent formatting
- Issue/PR templates, CONTRIBUTING.md, CODE_OF_CONDUCT.md, SECURITY.md

## [3.1.0] — 2025-04-01

### Added
- `enrich_agent_task` — builds structured context packages for sub-agent spawns
- `search_contracts` — searches extracted API contracts across projects
- `token_audit` — analyzes token usage patterns per session

## [3.0.0] — 2025-03-15

The rewrite. Moved from a loose collection of scripts to a proper MCP server with 24 tools.

### Added
- Full MCP server implementation using `@modelcontextprotocol/sdk`
- LanceDB vector search across session history
- Per-project data isolation (`~/.preflight/projects/<hash>/`)
- Local embeddings via `Xenova/all-MiniLM-L6-v2` (no API key required)
- Optional OpenAI embeddings for higher quality
- Session JSONL parser extracting 8 event types
- 12-category scorecard system
- `preflight-dev init` CLI for zero-config setup

### Breaking
- Requires Node 18+
- New config format (`.preflight/` directory replaces env-only config)
- Data stored in `~/.preflight/` instead of project-local directories

## [2.x] — 2025-01-xx

Early prototype. Single-file script with basic prompt scoring. Not published to npm.

---

[3.2.0]: https://github.com/TerminalGravity/preflight/releases/tag/v3.2.0
[3.1.0]: https://github.com/TerminalGravity/preflight/releases/tag/v3.1.0
[3.0.0]: https://github.com/TerminalGravity/preflight/releases/tag/v3.0.0
