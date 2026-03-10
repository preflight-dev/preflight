# Usage Examples

Real workflows showing how preflight tools work in practice.

---

## 1. The Basics: Let `preflight_check` Handle Everything

You don't need to call individual tools. Just use `preflight_check` and it routes your prompt automatically.

```
You:  "fix the auth bug"

preflight_check classifies this as AMBIGUOUS → chains clarify_intent:

  ⚠️ Ambiguous prompt detected. I found 3 auth-related issues:
  1. JWT expiry not refreshing → src/auth/jwt.ts:42
  2. OAuth callback returning 404 → src/auth/oauth.ts:118
  3. Session cookie missing SameSite → src/middleware/session.ts:15

  Which one? (Or say "all" and I'll sequence them.)
```

```
You:  "commit this"

preflight_check classifies this as TRIVIAL → passes through with no intervention.
```

```
You:  "refactor the rewards system to use event sourcing"

preflight_check classifies this as MULTI-STEP → chains scope_work + sequence_tasks:

  📋 Execution plan (4 phases):
  1. Define event types in src/rewards/events.ts
  2. Create event store adapter (src/rewards/store.ts)
  3. Migrate existing mutations to event dispatches
  4. Add projection layer for read models

  Estimated: ~800 lines changed across 12 files
  Risk: HIGH — touches billing integration
  Suggest: checkpoint before starting
```

---

## 2. Starting a Session Right

When you begin a coding session, `preflight_check` with a planning prompt sets context:

```
You:  "I'm working on the checkout flow today. The Stripe webhook
       handler drops events when the DB is under load."

preflight_check classifies this as CLEAR (specific + scoped):

  ✅ Good prompt. Context loaded:
  - Found 3 related sessions from last week touching src/payments/
  - Known correction: "webhook retry logic was added but not tested" (logged 3 days ago)
  - Related contract: StripeWebhookEvent type in shared-types/

  Ready to go.
```

---

## 3. Catching Repeat Mistakes with Correction Patterns

First, log a correction when Claude goes wrong:

```
You:  "No, don't use raw SQL — we always use Prisma for that table."

→ Use log_correction to record this:
  log_correction({ description: "Used raw SQL instead of Prisma for user table",
                   context: "src/db/queries.ts" })

  ✅ Logged. I'll warn you next time.
```

Later, when a similar prompt comes in:

```
You:  "write a query to get users by email"

preflight_check → check_patterns fires:

  ⚠️ Pattern match: You previously corrected "used raw SQL instead of Prisma
  for user table" (3 days ago). Make sure to use Prisma, not raw SQL.
```

---

## 4. Enriching Sub-Agent Tasks

Before spawning a sub-agent, use `enrich_agent_task` to give it real context:

```
You:  "have a sub-agent add input validation to the API routes"

enrich_agent_task returns:

  📦 Enriched task for sub-agent:
  "Add Zod input validation to these API routes:
   - POST /api/users (src/routes/users.ts:23)
   - PUT /api/users/:id (src/routes/users.ts:67)
   - POST /api/orders (src/routes/orders.ts:15)

   Existing patterns to follow:
   - src/routes/auth.ts uses z.object() with .parse() in middleware
   - Shared schemas in src/schemas/

   Related types from api-gateway:
   - CreateUserRequest, UpdateUserRequest (shared-types/api.d.ts)

   Run tests: npm test -- --grep 'routes'"
```

Without enrichment, the sub-agent would have to discover all of this itself (burning tokens).

---

## 5. Cross-Service Contract Search

When your prompt touches service boundaries:

```
You:  "update the notification payload to include user preferences"

search_contracts finds:

  🔗 Contracts across 2 projects:
  ├── current: NotificationPayload (src/types/notifications.ts:12)
  ├── api-gateway: POST /notifications/send expects { userId, type, data }
  └── shared-types: UserPreferences interface (src/user.d.ts:45)

  ⚠️ Changing NotificationPayload will break the api-gateway contract.
  Update both, or version the payload type.
```

---

## 6. Session Health Monitoring

Use `check_session_health` when things feel off:

```
check_session_health returns:

  🏥 Session Health:
  ├── Uncommitted files: 14 (⚠️ HIGH — commit soon)
  ├── Time since last commit: 47 min (⚠️ overdue)
  ├── Turn count: 38
  ├── Context usage: ~62% (OK)
  └── Recommendation: Run checkpoint now. You have 14 uncommitted
      files and haven't committed in 47 minutes.
```

---

## 7. End-of-Session Scorecard

After a session, generate a scorecard:

```
generate_scorecard({ type: "session" })

  📊 Session Scorecard — March 8, 2026
  ─────────────────────────────────────
  Plans .............. A  (started with clear scope)
  Clarification ...... B+ (82% of prompts had file refs)
  Delegation ......... A  (sub-agents got enriched context)
  Follow-ups ......... C  (3 vague follow-ups: "do the rest")
  Token Efficiency ... B  (7.2 calls/file — in ideal range)
  Sequencing ......... A- (1 topic switch)
  Compaction Mgmt .... A  (committed before both compactions)
  Session Lifecycle .. B  (avg 22 min between commits)
  Error Recovery ..... B+ (2 corrections, recovered in 1 msg each)
  Workspace Hygiene .. A  (CLAUDE.md up to date)
  Continuity ......... A  (read context on session start)
  Verification ....... C- (no tests run at end ⚠️)
  ─────────────────────────────────────
  Overall: B+ (83/100)

  💡 Tip: Run tests before ending sessions. Your Verification
     score has been C or below for 3 sessions in a row.
```

---

## 8. Semantic Search Across History

Search your past sessions for how you solved something before:

```
search_history({ query: "prisma migration rollback", scope: "all" })

  🔍 3 matches across 2 projects:
  1. [Feb 12] myapp session #47: "rolled back migration 20240212
     by creating a down migration manually — Prisma doesn't auto-generate"
     Relevance: 0.94

  2. [Jan 28] api-gateway session #31: "used prisma migrate resolve
     --rolled-back to mark failed migration"
     Relevance: 0.87

  3. [Feb 3] myapp session #52: "tip: always test migrations on a
     branch DB first — learned this the hard way"
     Relevance: 0.71
```

---

## Tips

- **Start simple.** Just use `preflight_check` for everything — it routes automatically.
- **Log corrections.** The more you log, the smarter pattern matching gets.
- **Set `CLAUDE_PROJECT_DIR`.** Without it, timeline/search features can't find your sessions.
- **Add `.preflight/config.yml`** for team settings — see [examples/.preflight/](./preflight/).
- **Check your scorecard weekly.** Trends matter more than individual scores.
