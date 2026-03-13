# Workflow Examples

Real-world usage patterns showing how preflight tools chain together in practice.

---

## 1. The Vague Bug Fix

You type: `fix the auth bug`

**Without preflight:** Claude guesses which bug, edits the wrong file, you correct it twice. ~12K tokens wasted.

**With preflight:**

```
You: fix the auth bug

→ preflight_check triages as "ambiguous" (no file path, no specific bug)
→ clarify_intent fires automatically
→ Returns:

  ⚠️ Ambiguous prompt — 3 possible targets:
  1. JWT refresh not triggering on 401 (src/auth/jwt.ts:47)
  2. OAuth callback returning 404 (src/auth/oauth.ts:112)
  3. Session cookie missing SameSite flag (src/middleware/session.ts:23)

  Recent correction history: You fixed #1 last week but it regressed.
  Suggestion: "Fix JWT refresh regression in src/auth/jwt.ts — the 401 retry logic from commit a3f2c1 stopped working after the axios upgrade"

You: [pick option 1, use the sharpened prompt]
→ Done in one pass. ~4K tokens.
```

## 2. Multi-File Refactor Planning

You type: `refactor the API layer to use tRPC instead of REST`

```
→ preflight_check triages as "multi-step"
→ scope_work runs:

  📋 Work Scope Analysis
  ──────────────────────
  Estimated scope: LARGE (15-25 files, ~3-5 sessions)

  Files involved:
  ├── src/pages/api/*.ts (12 REST endpoints → tRPC routers)
  ├── src/lib/api-client.ts (fetch calls → tRPC client)
  ├── src/types/api.ts (manual types → inferred from routers)
  └── tests/api/*.test.ts (all need rewriting)

  Cross-service contracts found:
  - mobile-app/src/api.ts imports shared types from @myapp/types
  - admin-dashboard/src/hooks/useApi.ts calls 6 of these endpoints

  ⚠️ Breaking changes for 2 downstream consumers.

  Suggested sequence:
  1. Install tRPC, create root router (1 session)
  2. Migrate endpoints one-by-one, keeping REST alive (2-3 sessions)
  3. Switch clients, remove REST layer (1 session)
  4. Update downstream consumers (1 session)

→ sequence_tasks breaks this into checkpointed steps
```

## 3. "Ship It" Without Checking

You type: `commit and push`

```
→ preflight_check triages as "trivial command" but runs verify_completion first:

  🔍 Pre-push checks:
  ├── ✅ TypeScript: no errors
  ├── ❌ Tests: 2 failing (auth.test.ts:34, auth.test.ts:67)
  ├── ⚠️ Unstaged files: 3 modified files not in this commit
  └── ⚠️ No conventional commit message provided

  Recommendation: Fix the 2 test failures before pushing.
  Staged files: src/auth/jwt.ts, src/auth/oauth.ts
  Unstaged: src/middleware/session.ts, tests/auth.test.ts, README.md

You: [fix tests first, then push with a proper commit message]
```

## 4. New Team Member Onboarding

Starting work on an unfamiliar codebase:

```
You: I just joined this project, help me understand the codebase

→ onboard_project runs:

  📖 Project: my-saas-app
  ──────────────────────
  Stack: Next.js 14 + Prisma + Supabase + Stripe
  Structure: App Router, 47 routes, 3 API namespaces

  Key patterns from 512 past sessions:
  - Auth uses Supabase Auth with custom JWT claims
  - Payments go through src/lib/stripe/ (webhook-driven)
  - DB migrations are in prisma/migrations/ (27 total)
  - Tests use Vitest + Playwright (not Jest)

  Common pitfalls (from correction history):
  - Don't use `getServerSession` in API routes — use `auth()` from next-auth
  - Stripe webhooks need raw body parsing (see src/app/api/webhooks/stripe/route.ts)
  - The `user` table has soft deletes — always filter by `deleted_at IS NULL`

  Hot files (most edited in last 30 days):
  1. src/app/(dashboard)/settings/page.tsx (23 edits)
  2. src/lib/stripe/subscriptions.ts (18 edits)
  3. prisma/schema.prisma (12 edits)
```

## 5. Cost-Conscious Session Management

Midway through a long session:

```
You: how much have I spent on this session?

→ session_stats + estimate_cost:

  📊 Session Stats
  ────────────────
  Duration: 2h 14m
  Messages: 47 (you: 23, Claude: 24)
  Tokens: ~180K in, ~95K out
  Estimated cost: $4.12

  Waste analysis:
  - 3 correction cycles detected (~$0.90 wasted)
  - 2 context compactions (session got too long)
  - Suggestion: checkpoint now and start a fresh session
    for the remaining work

→ checkpoint creates a handoff summary for the next session
→ session_handoff generates a paste-ready context block
```

## 6. Catching Repeated Mistakes

You've made the same error three times across sessions:

```
You: update the user schema to add a phone field

→ preflight_check notices a pattern match:

  ⚠️ Correction pattern detected!
  You've modified the User schema 3 times in the past week,
  and each time forgot to:
  1. Update the Zod validation in src/lib/validations/user.ts
  2. Add the field to the API serializer in src/lib/serializers.ts
  3. Run `npx prisma generate` after migration

  Auto-expanding scope to include all 3 steps.
```

---

## Tool Chaining Reference

| Scenario | Tools chained |
|----------|--------------|
| Vague prompt | `preflight_check` → `clarify_intent` → `prompt_score` |
| Big feature | `preflight_check` → `scope_work` → `sequence_tasks` → `search_contracts` |
| Pre-commit | `preflight_check` → `verify_completion` → `token_audit` |
| Debug session | `search_history` → `clarify_intent` → `check_patterns` |
| End of session | `session_stats` → `estimate_cost` → `checkpoint` → `session_handoff` |
| New codebase | `onboard_project` → `timeline_view` → `audit_workspace` |

---

## Tips

- **Always start with `preflight_check`** — it routes to the right tools automatically. You don't need to call individual tools unless you want to.
- **Set `CLAUDE_PROJECT_DIR`** so tools can find your files, git history, and past sessions.
- **Commit your `.preflight/` directory** — team members get the same triage rules and thresholds.
- **Review `log_correction` output weekly** — it shows recurring mistakes you can prevent with better prompts or project conventions.
