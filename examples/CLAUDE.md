# CLAUDE.md — Preflight Integration Example
#
# Drop this into your project's CLAUDE.md (or .claude/CLAUDE.md) to make
# Claude Code automatically use preflight tools during your sessions.
# Customize the rules below to match your workflow.

## Preflight Rules

Before starting any non-trivial task, run `preflight_check` with my prompt. This catches vague instructions before they waste tokens on wrong→fix cycles.

### When to use preflight tools:

- **Every prompt**: `preflight_check` triages automatically — let it decide what's needed
- **Before multi-file changes**: Run `scope_work` to get a phased plan
- **Before sub-agent tasks**: Use `enrich_agent_task` to add context
- **After making a mistake**: Use `log_correction` so preflight learns the pattern
- **Before ending a session**: Run `checkpoint` to save state for next time
- **When I say "fix it" or "do the others"**: Use `sharpen_followup` to resolve what I actually mean

### Session hygiene:

- Run `check_session_health` if we've been going for a while without committing
- If I ask about something we did before, use `search_history` to find it
- Before declaring a task done, run `verify_completion` (type check + tests)

### Don't preflight these:

- Simple git commands (commit, push, status)
- Formatting / linting
- Reading files I explicitly named
