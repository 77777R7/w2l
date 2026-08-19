# Contributing to W2L

Thank you for your interest in contributing to W2L!

## Developer Certificate of Origin (DCO)

We use the [Developer Certificate of Origin (DCO)](https://developercertificate.org/) to ensure contributors have the right to submit their code. Every commit must include a `Signed-off-by` line.

### How to Sign Off

Add `-s` when committing:

```bash
git commit -s -m "fix: handle redirect loops in bare HTTP subject"
```

This adds the following line to your commit message:

```
Signed-off-by: Your Name <your.email@example.com>
```

### What the DCO Means

By signing off, you certify that:

1. The contribution is your original work, OR
2. You have the right to submit it under the project's license, AND
3. You understand it will be distributed under AGPL-3.0

Full DCO text: https://developercertificate.org/

## Before You Contribute

1. **Check existing issues** — someone may already be working on it
2. **Open an issue first** for non-trivial changes — discuss the approach before writing code
3. **Read the engineering notes** — [PHASE1_ENGINEERING_NOTES.md](PHASE1_ENGINEERING_NOTES.md) explains the design decisions

## Development Setup

```bash
git clone https://github.com/YOUR_USERNAME/w2l.git
cd w2l
npm install
npm run typecheck
npm test
```

## Contribution Workflow

1. **Fork and branch** — create a feature branch from `main`
2. **Write tests** — new features need tests; bug fixes need a regression test
3. **Run the benchmark** — `npm run bench` to verify you didn't break ground-truth cases
4. **Commit with DCO** — every commit needs `git commit -s`
5. **Open a PR** — include:
   - What the change does
   - Which issue it fixes (if any)
   - Benchmark output (if relevant)
   - Test coverage (if relevant)

## Code Standards

- **TypeScript strict mode** — no `any`, no unchecked indexed access
- **Match existing style** — follow the patterns in the codebase
- **Write tests** — unit tests in `packages/*/test/*.test.ts`
- **Document contracts** — update `packages/contracts` if you change the schema
- **Commit messages** — use conventional commits (`fix:`, `feat:`, `docs:`, etc.)

## Testing

```bash
# Run all tests
npm test

# Run tests for one package
npm test -- packages/http-core

# Run benchmark
npm run bench
```

## Questions?

Open an issue with the `question` label.
