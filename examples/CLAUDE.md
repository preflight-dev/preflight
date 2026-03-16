# CLAUDE.md — Example Project Instructions with Preflight

> Copy this to your project root and customize it. Claude Code reads this file
> automatically at the start of every session.

## Preflight Integration

Before starting any non-trivial task, run `preflight_check` with my prompt.
Follow its recommendations — if it says clarify, ask me before proceeding.

When I give a vague prompt (e.g., "fix the tests"), don't guess. Use preflight
to identify what's ambiguous, then ask me to be specific.

## Project Overview

- **Stack:** Next.js 14, TypeScript, Prisma, Supabase
- **Monorepo:** `apps/web`, `packages/shared`, `services/auth`
- **Node version:** 20+
- **Package manager:** pnpm

## Conventions

- All new files in TypeScript (no `.js`)
- Use `@/` path alias for imports from `src/`
- Tests go next to source files: `foo.ts` → `foo.test.ts`
- Commit messages: conventional commits (`feat:`, `fix:`, `docs:`, etc.)
- Run `pnpm lint && pnpm test` before committing

## Key Files

- `prisma/schema.prisma` — database schema (source of truth for types)
- `src/lib/auth.ts` — auth helpers, JWT validation
- `src/middleware.ts` — route protection, redirects
- `.env.local` — local env vars (never commit)

## Things That Break Easily

- Changing Prisma schema without running `pnpm prisma generate`
- Modifying auth middleware without testing both logged-in and logged-out flows
- Adding new API routes without updating the OpenAPI spec in `docs/api.yml`

## What I Care About

- Don't over-engineer. Simple > clever.
- Explain *why* before showing code if the approach isn't obvious.
- If a task touches multiple services, check contracts first (`search_contracts`).
