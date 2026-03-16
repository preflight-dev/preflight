# Contributing to Preflight

Thanks for your interest in contributing! This guide will help you get started.

## Prerequisites

- Node.js 20+
- npm

## Setup

```bash
git clone https://github.com/TerminalGravity/preflight.git
cd preflight
npm install
npm run build
npm test
```

## Development Workflow

1. Fork the repository
2. Create a feature branch: `git checkout -b feat/my-feature`
3. Make your changes
4. Run tests: `npm test`
5. Run lint: `npm run lint`
6. Commit using conventional commits (see below)
7. Push and open a Pull Request

## Commit Messages

We use [Conventional Commits](https://www.conventionalcommits.org/):

- `feat:` — new feature
- `fix:` — bug fix
- `chore:` — maintenance (deps, config, CI)
- `test:` — adding or updating tests
- `docs:` — documentation only

Examples:
```
feat: add support for custom triage rules
fix: handle empty prompt in scoring tool
test: add edge cases for pattern matching
```

## Code Style

- TypeScript with strict mode
- ESLint for linting (`npm run lint`)
- 2-space indentation
- Prefer explicit types over `any`

## Pull Request Checklist

- [ ] Tests pass (`npm test`)
- [ ] Lint passes (`npm run lint`)
- [ ] Build succeeds (`npm run build`)
- [ ] Description explains what changed and why
- [ ] New features include tests

## Reporting Issues

- Use the bug report template for bugs
- Use the feature request template for ideas
- Include reproduction steps when reporting bugs
- Check existing issues before creating new ones
