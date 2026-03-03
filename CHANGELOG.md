# Changelog

All notable changes to preflight-dev are documented here.

Format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [3.2.0] — 2025-06-15

### Added
- **Unified `preflight_check` entry point** — one tool that triages every prompt and chains the right checks automatically
- **Smart triage classification** — routes prompts through a decision tree: trivial → clear → ambiguous → cross-service → multi-step
- **Correction pattern learning** — `log_correction` + `check_patterns` remember past mistakes and warn before you repeat them
- **Cross-service contract awareness** — extracts types, interfaces, routes, and schemas across related projects
- **`.preflight/` config directory** — team-shareable YAML config for triage rules, thresholds, and manual contracts
- **Trend & comparative scorecards** — weekly/monthly trend lines, cross-project comparisons, radar charts, PDF export
- **`estimate_cost` tool** — estimates token spend and waste from corrections per session
- **Per-project LanceDB databases** with cross-project semantic search

### Fixed
- Vague-verb detection no longer triggers when the prompt includes file paths or line numbers
- Duplicate `.preflight/` creation block removed from `init.ts`

## [3.1.0] — 2025-05-20

### Added
- `search_timeline` — LanceDB vector search across months of session history
- `onboard_project` — ingest JSONL session files into per-project timeline databases
- `search_contracts` — find types, interfaces, and API routes across related services
- Profile system for tool filtering (full, lite, scoring-only, timeline-only)
- Project registry at `~/.preflight/projects/index.json`

### Changed
- Embedding model configurable via `.preflight/config.yml` (default: `text-embedding-3-small`)

## [3.0.0] — 2025-04-28

### Added
- 24 tools across 5 categories (up from 14 in v2.x)
- `session_handoff` — export session context for continuation
- `what_changed` — diff summary since last checkpoint
- `verify_completion` — post-task verification checklist
- `audit_workspace` — detect stale branches, uncommitted files, config drift
- `generate_scorecard` — 12-category prompt quality scorecards with letter grades

### Changed
- Tools reorganized into logical categories (Prompt Discipline, Timeline Intelligence, Analysis, Verification)
- MCP SDK updated to latest `@modelcontextprotocol/sdk`

### Breaking
- Tool names standardized to `snake_case` (e.g., `scopeWork` → `scope_work`)
- Environment variable `PREFLIGHT_PROJECT` renamed to `CLAUDE_PROJECT_DIR`

## [2.0.0] — 2025-03-10

### Added
- Initial MCP server with 14 tools
- `clarify_intent`, `scope_work`, `sequence_tasks`, `sharpen_followup`
- `token_audit`, `checkpoint`, `session_health`
- `enrich_agent_task` for sub-agent delegation
- `prompt_score` with basic scoring rubric
- Session stats and correction logging

### Changed
- Migrated from CLI-only to MCP server architecture

## [1.0.0] — 2025-01-15

### Added
- Initial release as CLI tool
- Basic prompt analysis and scoring
- Session JSONL parsing

[3.2.0]: https://github.com/TerminalGravity/preflight/releases/tag/v3.2.0
[3.1.0]: https://github.com/TerminalGravity/preflight/releases/tag/v3.1.0
[3.0.0]: https://github.com/TerminalGravity/preflight/releases/tag/v3.0.0
[2.0.0]: https://github.com/TerminalGravity/preflight/releases/tag/v2.0.0
[1.0.0]: https://github.com/TerminalGravity/preflight/releases/tag/v1.0.0
