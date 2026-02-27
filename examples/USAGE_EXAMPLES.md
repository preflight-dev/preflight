# Usage Examples

Real-world examples of preflight tools in action inside Claude Code.

---

## 1. Catching a Vague Prompt with `preflight_check`

You type this into Claude Code:

```
fix the login bug
```

Preflight intercepts and returns:

```
⚠️ Ambiguity detected — routing to clarify_intent

I found 3 potential login issues:
  1. JWT token not refreshing on expiry (src/auth/jwt.ts:42)
  2. OAuth callback returning 404 after redirect (src/auth/oauth.ts:118)
  3. "Remember me" checkbox not persisting session (src/components/LoginForm.tsx:23)

Which one? Or describe the symptoms and I'll narrow it down.
```

Instead of Claude guessing and editing the wrong file, you get a targeted question. One round-trip instead of three.

---

## 2. Scoping Work Before Coding with `scope_work`

```
> scope_work "Add rate limiting to the /api/upload endpoint"

📋 Execution Plan
─────────────────
Goal: Add rate limiting to POST /api/upload

Files to touch:
  - src/api/routes/upload.ts (add middleware)
  - src/middleware/rateLimit.ts (create)
  - src/config/limits.ts (add upload limits)
  - tests/api/upload.test.ts (add rate limit tests)

Dependencies:
  - Check if express-rate-limit is already installed
  - Review existing middleware chain in src/api/index.ts

Risks:
  - Existing upload tests may break if rate limit hits in CI
  - Need to decide: per-IP or per-user limiting?

Estimated scope: ~120 lines across 4 files
```

---

## 3. Enriching a Sub-Agent Task with `enrich_agent_task`

You want to spawn a sub-agent for a refactor:

```
> enrich_agent_task "refactor the database queries to use the new ORM"

📦 Enriched Task Brief
──────────────────────
Original: "refactor the database queries to use the new ORM"

Context added:
  - ORM: Drizzle (see drizzle.config.ts, src/db/schema.ts)
  - 14 files with raw SQL queries (grep results attached)
  - Existing patterns: src/db/queries/users.ts uses query builder already
  - Related contracts: UserRecord, PostRecord types in src/types/db.ts
  - Test coverage: 8/14 query files have corresponding tests

Suggested task for sub-agent:
  "Refactor raw SQL queries in src/db/queries/ to use Drizzle ORM.
   Follow the pattern in src/db/queries/users.ts. Schema is in
   src/db/schema.ts. Run `npm test -- --grep db` after each file.
   14 files total — see list below."
```

The sub-agent gets everything it needs instead of fumbling through the codebase.

---

## 4. Resolving Vague Follow-ups with `sharpen_followup`

After Claude fixes a bug, you say:

```
> do the same for the others
```

Without preflight, Claude guesses what "the others" means. With it:

```
> sharpen_followup "do the same for the others"

🔍 Resolved "the others" from conversation context:

You just fixed a missing null check in src/api/users.ts:34.
Similar pattern found in 4 other files:
  1. src/api/posts.ts:28 — same nullable field access
  2. src/api/comments.ts:41 — same pattern
  3. src/api/teams.ts:55 — same pattern
  4. src/api/billing.ts:19 — slightly different (optional chain exists but incomplete)

Shall I apply the fix to all 4?
```

---

## 5. Checking Session Health with `check_session_health`

```
> check_session_health

🏥 Session Health
─────────────────
⏱  Session duration: 47 min
📝 Uncommitted files: 8 (⚠️ commit soon)
🔄 Last commit: 38 min ago (⚠️ overdue)
💬 Turn count: 23
📊 Context usage: ~62% (healthy)
🎯 Focus score: B (2 directory switches)

Recommendation: Commit your current changes before continuing.
Run `checkpoint` to save state.
```

---

## 6. Searching Past Sessions with `search_history`

```
> search_history "how did we handle the Stripe webhook retry logic"

🔍 Found 3 relevant results across 2 sessions:

Session 2024-12-15 (confidence: 0.92)
  "Implemented exponential backoff for Stripe webhook retries
   in src/webhooks/stripe.ts. Uses 3 retries with 1s/4s/16s delays.
   Idempotency key stored in Redis."

Session 2024-11-28 (confidence: 0.78)
  "Discussed webhook retry strategies. Decided against queue-based
   approach due to infrastructure complexity. Went with in-process
   retry with circuit breaker."
```

Never re-research decisions you already made.

---

## 7. Getting a Scorecard with `generate_scorecard`

```
> generate_scorecard type=trend period=week

📊 Weekly Trend — Jan 20–26, 2025
──────────────────────────────────
Overall: B+ (78/100) ↑ from B (74) last week

Improving:
  ✅ Clarification: 82 → 89 (+7) — more file refs in prompts
  ✅ Verification: 65 → 78 (+13) — running tests before done

Declining:
  ⚠️ Compaction Mgmt: 71 → 58 (-13) — 3 compactions without prior commit
  ⚠️ Session Lifecycle: 80 → 72 (-8) — longer gaps between commits

Top tip: Run `checkpoint` before long exploratory conversations
to avoid losing work on compaction.
```

---

## 8. Quick Prompt Grading with `prompt_score`

```
> prompt_score "update the thing"

📝 Prompt Score: D (32/100)
───────────────────────────
Specificity:    F — no file, function, or component named
Scope:          F — "the thing" is completely ambiguous
Actionability:  D — "update" is vague (add? change? remove?)
Done-condition: F — no way to verify completion

Try: "Update the user avatar upload handler in src/api/users.ts
to accept WebP format and add a test case"  → A (94/100)
```

---

## Tips

- **Start every session** with `preflight_check` on your first prompt — it'll route to the right tool automatically
- **Use `checkpoint`** every 20–30 minutes or before exploring a new direction
- **Run `search_history`** before implementing something — you may have solved it before
- **Check `session_stats`** at the end of a session to spot waste patterns
- **Set up `.preflight/config.yml`** to tune thresholds for your team (see [examples/.preflight/](/.preflight/))
