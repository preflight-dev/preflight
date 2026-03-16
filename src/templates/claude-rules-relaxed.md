# Preflight Rules (Relaxed Mode)

## Recommended Practices

- Call `preflight_check` before large or complex tasks spanning multiple files.
- Use `clarify_intent` when a prompt seems vague or underspecified.
- Use `verify_completion` before wrapping up significant tasks.
- Call `checkpoint` periodically during long sessions to save progress.
- Use `what_changed` to review modifications before committing.
