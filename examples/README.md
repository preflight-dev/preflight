# Examples

## `.preflight/` Config Directory

The `.preflight/` directory contains example configuration files you can copy into your project root:

```
.preflight/
├── config.yml              # Main config — profile, related projects, thresholds
├── triage.yml              # Triage rules — keywords, strictness
└── contracts/
    └── api.yml             # Manual contract definitions for cross-service types
```

### Quick setup

```bash
# From your project root:
cp -r /path/to/preflight/examples/.preflight .preflight

# Edit paths in config.yml to match your setup:
$EDITOR .preflight/config.yml
```

Then commit `.preflight/` to your repo — your whole team gets the same preflight behavior.

### What each file does

| File | Purpose | Required? |
|------|---------|-----------|
| `config.yml` | Profile, related projects, thresholds, embedding config | No — sensible defaults |
| `triage.yml` | Keyword rules for prompt classification | No — sensible defaults |
| `contracts/*.yml` | Manual type/interface definitions for cross-service awareness | No — auto-extraction works without it |

All files are optional. Preflight works out of the box with zero config — these files let you tune it to your codebase.

---

## Usage Examples

Once preflight is registered as an MCP server, these tools are available inside Claude Code. Here's what real usage looks like for the most common tools.

### `preflight_check` — The unified entry point

This is the tool you'll use most. It triages your prompt and automatically chains the right checks.

**Vague prompt → caught and clarified:**

```
You: "fix the tests"

preflight_check fires → triage level: AMBIGUOUS

🚨 Ambiguous prompt detected — clarification needed:

  Which tests? I found:
  • 14 test files in tests/
  • 3 currently failing:
    - tests/triage.test.ts (assertion error line 42)
    - tests/config.test.ts (timeout)
    - tests/patterns.test.ts (missing fixture)

  Also: 2 correction patterns matched — last time "fix tests" led to
  editing the wrong test file. Be specific about which test and what
  the expected behavior should be.
```

**Specific prompt → green light with context:**

```
You: "refactor src/lib/triage.ts to extract the keyword matching into its own function"

preflight_check fires → triage level: CLEAR

✅ Prompt is clear. Context gathered:
  • Branch: feat/triage-refactor (3 commits ahead of main)
  • src/lib/triage.ts — 287 lines, last modified 2h ago
  • 2 files import from triage.ts: preflight-check.ts, clarify-intent.ts
  • No related correction patterns found
```

### `prompt_score` — Gamified prompt quality

Scores your prompt on specificity, context, and actionability. Tracks your session average.

```
You: "add error handling"

prompt_score result:
  Score: 3/10 ⚠️
  - Missing: which file? what errors? what should happen on failure?
  - Session average: 6.2 (↓ from 7.1)
  - Tip: try "add try/catch to src/lib/embeddings.ts embedText() —
    catch fetch failures and return a fallback zero vector"
```

### `scope_work` — Plan before you build

Generates a scoped work plan with file targets, risk areas, and estimated complexity.

```
You: "add OAuth login with Google"

scope_work result:
  📋 Work Plan: Google OAuth Integration

  Files to create:
  • src/auth/google.ts — OAuth flow handler
  • src/auth/callback.ts — Token exchange endpoint

  Files to modify:
  • src/middleware/session.ts — add OAuth session type
  • src/types.ts — add GoogleUser interface

  Dependencies to add:
  • googleapis or passport-google-oauth20

  Risk areas:
  • Session cookie config (SameSite issues in dev)
  • Redirect URI mismatch between dev/prod

  Estimated scope: Medium (4-6 files, ~200 lines)
  Related contracts: UserSession interface in api.yml
```

### `estimate_cost` — Know before you go

Estimates token spend for a task based on historical patterns.

```
You: "rewrite the entire scoring engine"

estimate_cost result:
  💰 Estimated cost for this task:
  • Estimated tokens: ~45,000 (input) + ~12,000 (output)
  • Estimated cost: ~$0.85
  • Based on: 3 similar refactoring tasks in history
  • Warning: Large refactors average 2.1 correction cycles —
    consider breaking into smaller pieces
```

### `log_correction` — Teach preflight your patterns

When Claude goes wrong, log it so preflight warns you next time.

```
You: log_correction("said 'update the config' and Claude edited
     package.json instead of .preflight/config.yml")

✅ Correction logged.
  Pattern: "update config" → wrong file target
  Next time you say "update config", preflight will ask which config file.
```

### `search_history` — Find anything from past sessions

Semantic search across all your Claude Code session history.

```
You: "how did I set up the database migrations last month?"

search_history result:
  Found 3 relevant sessions:

  1. [Feb 14] "Set up Prisma migrations for user table"
     → Created prisma/migrations/001_users.sql
     → Used `prisma migrate dev --name init`

  2. [Feb 16] "Fix migration conflict after schema change"
     → Resolved by resetting dev DB: `prisma migrate reset`

  3. [Feb 20] "Add index to sessions table"
     → prisma/migrations/003_session_index.sql
```

### Workflow tip: Let `preflight_check` run automatically

Add this to your Claude Code custom instructions (CLAUDE.md):

```markdown
Before executing any task, run preflight_check with the user's prompt.
If the triage level is AMBIGUOUS or higher, present the clarification
before proceeding. Never skip preflight on multi-file changes.
```

This makes preflight automatic — you don't have to remember to call it.
