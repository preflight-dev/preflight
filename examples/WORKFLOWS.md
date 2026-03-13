# Workflow Examples

Real-world examples of how preflight catches problems before they cost you tokens.

---

## 1. Catching a Vague Prompt

You type this into Claude Code:

```
fix the auth bug
```

Preflight intercepts via `preflight_check` and classifies it as **AMBIGUOUS**:

```json
{
  "triage": {
    "level": "ambiguous",
    "confidence": 0.85,
    "reasons": [
      "No file reference — 'auth' could be JWT, OAuth, session, or middleware",
      "Vague verb 'fix' without specifying the symptom or expected behavior",
      "Multiple auth-related files found in project"
    ],
    "recommended_tools": ["clarify_intent"]
  },
  "clarification": {
    "questions": [
      "Which auth component? I found: src/auth/jwt.ts, src/auth/oauth.ts, src/middleware/session.ts",
      "What's the symptom — login failing, token expiring, 403 errors?",
      "Should this fix include tests?"
    ]
  }
}
```

**What you do:** Answer the clarification, get a precise fix in one pass.

---

## 2. Multi-Step Task Planning

You type:

```
refactor the user model to support teams and update all the API routes
```

Preflight classifies this as **MULTI-STEP** and suggests a plan:

```json
{
  "triage": {
    "level": "multi-step",
    "confidence": 0.92,
    "reasons": [
      "Two distinct operations: schema change + API route updates",
      "Schema change has downstream effects on queries, types, and tests",
      "Cross-cutting concern: 'all API routes' is unbounded scope"
    ],
    "recommended_tools": ["scope_work", "clarify_intent"]
  },
  "scope": {
    "suggested_steps": [
      "1. Define the Team model and User→Team relation in schema",
      "2. Generate and run migration",
      "3. Update User type definitions (shared-types if cross-service)",
      "4. Update API routes that read/write User (list specific files)",
      "5. Update tests for affected routes",
      "6. Run full test suite"
    ],
    "estimated_files": 12,
    "risk": "medium — schema migration affects production data"
  }
}
```

**What you do:** Tackle it step by step instead of one giant prompt.

---

## 3. Cross-Service Contract Awareness

You type:

```
change the User type to add a teamId field
```

With `related_projects` configured in `.preflight/config.yml`, preflight detects **CROSS-SERVICE** impact:

```json
{
  "triage": {
    "level": "cross-service",
    "confidence": 0.88,
    "reasons": [
      "User type is defined in contracts (shared across auth, billing)",
      "Matched related project aliases: auth, billing, types"
    ],
    "recommended_tools": ["search_contracts", "clarify_intent"]
  },
  "contracts": {
    "affected": [
      { "project": "auth", "file": "src/types/user.ts", "usage": "JWT payload includes User fields" },
      { "project": "billing", "file": "src/api/subscription.ts", "usage": "Reads User.tier for pricing" },
      { "project": "types", "file": "src/index.ts", "usage": "Canonical User interface" }
    ],
    "warning": "Changing User shape requires updates in 3 downstream services"
  }
}
```

**What you do:** Update all consumers in one coordinated pass instead of breaking downstream services.

---

## 4. Correction Pattern Detection

After the third time Claude edits the wrong test file, preflight learns the pattern:

```
update the tests
```

```json
{
  "triage": {
    "level": "ambiguous",
    "confidence": 0.95,
    "reasons": [
      "Correction pattern detected: 3 past corrections for 'tests' → user meant integration tests in tests/integration/, not unit tests in __tests__/"
    ],
    "recommended_tools": ["clarify_intent", "check_patterns"]
  },
  "patterns": {
    "matched": [
      {
        "pattern": "When user says 'tests' without qualifier, they mean tests/integration/",
        "corrections": 3,
        "last_seen": "2025-01-15"
      }
    ]
  }
}
```

**What you do:** Preflight pre-fills the right context so you don't burn tokens on the same mistake again.

---

## 5. Trivial Prompts Pass Through

Not everything needs guardrails. Mechanical tasks skip checks entirely:

```
commit this with message "fix typo in README"
```

```json
{
  "triage": {
    "level": "trivial",
    "confidence": 0.99,
    "reasons": ["Matches trivial command: commit"],
    "recommended_tools": []
  }
}
```

No friction for simple tasks.

---

## 6. Using Scorecards to Improve Over Time

After a coding session, generate a scorecard:

```
generate a scorecard for this session
```

Preflight analyzes your prompts and returns a 12-category breakdown:

```
Category                  Score   Notes
─────────────────────────────────────────────────
Prompt Specificity        7/10    3 prompts lacked file refs
Context Reuse             9/10    Good use of prior context
Scope Control             5/10    2 unbounded "update all" prompts
Correction Rate           6/10    4 corrections in 28 prompts
Session Hygiene           8/10    Reasonable session length
...

Overall: 7.1/10
Estimated waste: ~4,200 tokens (12% of session)
Top suggestion: Add file paths to prompts — would have prevented 3 clarification rounds
```

**What you do:** Track your score over weeks. Teams using preflight typically see a 20-30% reduction in token waste within the first month.

---

## Setup Recap

1. Install: `claude mcp add preflight -- npx -y preflight-dev-serve`
2. (Optional) Copy config: `cp -r examples/.preflight .preflight`
3. Start coding — preflight runs automatically on every prompt

That's it. No behavior changes required — preflight intercepts and advises in the background.
