# Dependency hygiene (P0, local)

This records the dependency posture of the prototype. It is a **local** analysis
only. Dependency changes are made as planned, tested groups; `npm audit fix
--force` is never used.

## Policy

- The stack is deliberately small. No dependency is added "just in case".
- Money and date logic are hand-written in `src/domain/` on purpose, not pulled
  from a library, to keep the rules auditable and dependency-free.
- `npm audit fix --force` is **not** run. Major upgrades are only done as a
  planned, tested change, one justified group at a time.
- A breaking major bump is out of scope for the P0 hardening pass unless it is
  required to close a defect we can actually reach at runtime.

## Runtime advisories — resolved

`npm audit --omit=dev` now reports **0 vulnerabilities**. The two runtime
advisories were cleared:

- **`zod` (high)** — the package was declared but never imported anywhere in
  `src/`, `tests/`, or `e2e/`. It was **removed** rather than major-upgraded:
  shipping an unused dependency with a known high advisory has no upside.
- **`react-router-dom` (moderate, + transitive `react-router`)** — upgraded
  `6.30.6 → 7.18.6`. The only code impact was that `useNavigate()` now returns a
  promise; the single call site is marked with `void`. The v7 future-flag
  warnings in tests are gone. Full gate (`verify:full`) and E2E stayed green.

## Dev-toolchain advisories (tracked, deliberately deferred)

The remaining `npm audit` entries are all in the **dev/build toolchain** and
never reach a user's browser. Their only fixes are breaking majors:

| Package                                                                                   | Severity     | Scope          | Fix offered          | Why deferred now                                       |
| ----------------------------------------------------------------------------------------- | ------------ | -------------- | -------------------- | ------------------------------------------------------ |
| `vitest`                                                                                  | critical     | dev-only       | `vitest@5` (major)   | Test tool only; never shipped to a user.               |
| `@vitest/coverage-v8`                                                                     | critical     | dev-only       | v5 (major)           | Test tool only.                                        |
| `vite`                                                                                    | high         | dev/build tool | `vite@8` (major)     | Build tool only; the built bundle does not include it. |
| `esbuild`, `tinypool`, `glob`, `minimatch`, `@vitest/mocker`, `vite-node`, `test-exclude` | low–critical | dev-only       | via the majors above | Transitive dev-tool dependencies; no user surface.     |

A follow-up task can upgrade the dev toolchain as one tested group if desired;
it is not a security exposure.

## What was done

- `zod` removed (unused); `react-router-dom` upgraded to v7; `npm audit --omit=dev`
  is clean.
- The full gate is `npm run verify:full` (format, lint, typecheck, coverage,
  build); E2E is `npm run e2e`. Both stayed green across the upgrade.

## Licenses

Top-level production dependency licenses are permissive (MIT / 0BSD). The one
`UNLICENSED` entry is this private package itself. No copyleft license was found
in the production tree during this pass; a full license sweep with a dedicated
tool is still recommended before any public release.

## How to re-check

```bash
npm audit                 # advisories (read-only, never --fix --force)
npm audit --omit=dev      # runtime-only exposure
npx license-checker --production --summary   # license inventory
```
