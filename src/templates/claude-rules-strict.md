# Preflight Rules (Strict Mode)

## Before Starting Work

- **ALWAYS** call `preflight_check` before any multi-file task or task involving more than 3 tool calls.
- **ALWAYS** call `clarify_intent` when a prompt is ambiguous or could be interpreted multiple ways.
- **ALWAYS** call `scope_work` before tasks that touch more than 2 files.

## During Work

- Call `checkpoint` every 100 tool calls or when completing a logical milestone.
- Call `session_health` if you notice degraded performance or context confusion.
- Call `search_history` before re-implementing something that may already exist in the session.

## Before Completing Work

- **ALWAYS** call `verify_completion` before declaring a task done.
- **ALWAYS** call `prompt_score` on your own summary to ensure clarity.
- Call `generate_scorecard` at the end of significant work sessions.

## Error Handling

- If a task fails, call `log_correction` to record the pattern.
- Call `what_changed` to review your modifications before committing.
- Use `token_audit` if the session feels expensive or bloated.
