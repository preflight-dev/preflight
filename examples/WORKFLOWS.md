# Workflow Examples

Real-world examples of preflight catching problems before they cost you tokens.

---

## 1. Vague Bug Fix → Clarified Scope

**Without preflight:**
```
You: fix the login bug
Claude: *edits src/auth/login.ts, breaks OAuth flow*
You: no, the other one — the session timeout
Claude: *undoes changes, starts over*
→ 3 rounds, ~15,000 tokens wasted
```

**With preflight:**
```
You: fix the login bug

preflight_check fires → classifies as AMBIGUOUS
→ "I found 4 login-related issues in recent history:
   1. Session timeout not refreshing (src/auth/session.ts:42)
   2. OAuth callback returning 404 (src/auth/oauth.ts:118)
   3. Password reset email not sending (src/auth/reset.ts:67)
   4. CSRF token mismatch on mobile (src/middleware/csrf.ts:23)
   Which one? Or describe the symptoms."

You: the session timeout one
→ Scoped fix, ~4,000 tokens, done right
```

---

## 2. Multi-Step Refactor → Structured Plan

**Without preflight:**
```
You: refactor the API to use the new auth
Claude: *starts changing files, misses 3 consumers, breaks billing integration*
```

**With preflight:**
```
You: refactor the API to use the new auth

preflight_check fires → classifies as MULTI-STEP + CROSS-SERVICE
→ Pulls contracts from auth-service and billing-api
→ "This touches 3 services. Here's a suggested plan:
   1. Update shared AuthToken type in shared-types/
   2. Migrate auth-service endpoints (3 routes)
   3. Update billing-api consumer (imports AuthToken)
   4. Update main API auth middleware
   5. Run cross-service type check
   Want me to proceed step by step, or adjust the plan?"
```

---

## 3. Repeated Mistake → Pattern Warning

After you've corrected Claude a few times about the same thing:

```
You: update the user schema

preflight_check fires → correction pattern detected
→ "⚠️ Heads up — in past sessions you've corrected me 3 times
   about the user schema:
   - Don't modify the `tier` field without updating billing-api
   - Always run `prisma migrate dev` after schema changes
   - The `createdAt` default is set at the DB level, not in Prisma
   Proceeding with these constraints."
```

---

## 4. Session Drift → Context Recovery

You've been working for 2 hours and the context window is getting full:

```
You: where was I on the notification system?

search_sessions fires → searches LanceDB vector index
→ "Found 3 relevant sessions from this week:
   - Tuesday 2pm: Designed webhook payload schema (WebhookPayload type)
   - Tuesday 4pm: Implemented notification dispatch in auth-service
   - Wednesday 10am: Started consumer in billing-api, stopped at error handling
   Last commit: 'feat: add notification dispatch endpoint'
   You were about to add retry logic to the billing consumer."
```

---

## 5. Quick Commands → Zero Overhead

Preflight doesn't slow you down on simple tasks:

```
You: commit this
→ preflight_check classifies as TRIVIAL → passes through instantly

You: format src/
→ TRIVIAL → passes through

You: run the tests
→ TRIVIAL → passes through
```

The triage engine only intervenes when it can save you tokens.

---

## 6. Onboarding a New Codebase

First time running preflight on a project:

```
You: onboard this project

onboard_project fires →
→ Scans project structure, package.json, tsconfig
→ Indexes session history into LanceDB
→ Extracts contracts from source files
→ "Onboarding complete:
   - 847 sessions indexed (last 6 months)
   - 23 contracts extracted (12 types, 8 interfaces, 3 routes)
   - 4 related projects detected from imports
   - Suggested .preflight/config.yml written (review it)"
```

---

## Tips

- **Start with `npx`** — don't clone unless you want to contribute
- **Let triage do its thing** — you don't need to call specific tools manually
- **Commit `.preflight/`** — your team gets consistent behavior
- **Check your scorecard weekly** — `generate_scorecard` shows where you're improving
- **Use `search_sessions` when you lose context** — it's faster than scrolling
