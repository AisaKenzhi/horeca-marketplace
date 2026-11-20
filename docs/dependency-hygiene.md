# Dependency hygiene (P0, local)

This records the dependency posture of the prototype. It is a **local** analysis
only; nothing here upgrades a major version, changes the lockfile policy, or
touches a remote.

## Policy

- The stack is deliberately small. No dependency is added "just in case".
- Money and date logic are hand-written in `src/domain/` on purpose, not pulled
  from a library, to keep the rules auditable and dependency-free.
- `npm audit fix --force` is **not** run. Major upgrades are only done as a
  planned, tested change, one justified group at a time.
- A breaking major bump is out of scope for the P0 hardening pass unless it is
  required to close a defect we can actually reach at runtime.

## Current advisories (tracked, deliberately deferred)

`npm audit` reports advisories whose **only** fix is a breaking major upgrade:

| Package                                                                                   | Severity     | Scope          | Fix offered          | Why deferred now                                                                  |
| ----------------------------------------------------------------------------------------- | ------------ | -------------- | -------------------- | --------------------------------------------------------------------------------- |
| `zod`                                                                                     | high         | runtime dep    | `zod@4.6.7` (major)  | Major rewrite; the prototype barely uses `zod` and never on untrusted bulk input. |
| `react-router-dom`                                                                        | moderate     | runtime dep    | `react-router-dom@7` | Major router migration; would touch every screen and the E2E flow.                |
| `react-router`                                                                            | moderate     | transitive     | via router-dom 7     | Follows the router upgrade above.                                                 |
| `vitest`                                                                                  | critical     | dev-only       | `vitest@5` (major)   | Test tool only; never shipped to a user. No runtime exposure.                     |
| `@vitest/coverage-v8`                                                                     | critical     | dev-only       | v5 (major)           | Test tool only.                                                                   |
| `vite`                                                                                    | high         | dev/build tool | `vite@8` (major)     | Build tool only; the built bundle does not include Vite.                          |
| `esbuild`, `tinypool`, `glob`, `minimatch`, `@vitest/mocker`, `vite-node`, `test-exclude` | low–critical | dev-only       | via the majors above | Transitive dev-tool dependencies; no user-facing surface.                         |

Notes:

- The **critical/high** entries are all in the **dev/test toolchain** (vitest,
  coverage, vite, esbuild) and never reach a user's browser.
- The two **runtime** advisories (`zod`, `react-router-dom`) are moderate/high and
  require breaking upgrades. A follow-up task should plan the router 7 and zod 4
  migrations together, behind the full test + E2E gate.

## What is safe to do, and what was done

- `npm audit` was run (read-only) and this document was written. No lockfile was
  modified, no major version was changed.
- The full test suite and E2E must stay green before any future dependency
  change; `npm run verify:full` runs format, lint, typecheck, coverage and build.

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
