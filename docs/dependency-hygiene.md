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

## Dev-toolchain advisories — resolved

The dev/build toolchain was upgraded as one tested group, clearing every
remaining advisory (including the transitive ones):

| Package                | From  | To      |
| ---------------------- | ----- | ------- |
| `vite`                 | `5.4` | `8.3.8` |
| `vitest`               | `2.1` | `5.1.1` |
| `@vitest/coverage-v8`  | `2.1` | `5.1.1` |
| `@vitejs/plugin-react` | `4.7` | `6.3.0` |

`esbuild`, `tinypool`, `glob`, `minimatch`, `@vitest/mocker`, `vite-node` and
`test-exclude` came along as transitive dev-only dependencies.

Notes on the upgrade:

- The majors cannot be staged one at a time: `@vitejs/plugin-react@6` requires
  `vite@^8`, and `vitest@5` already accepts `vite@^8`/`^7`/`^6`. They were moved
  together, with the lockfile regenerated from the new `package.json`.
- Vitest 5's v8 coverage provider measures branches differently than vitest 2,
  so the reported numbers moved. Rather than lower the floor to hide the change,
  real tests were added (`errors.test.ts`, `storage.test.ts`,
  `describeRevisionLine`) and the floors were left where the honest post-upgrade
  values clear them.
- `npm audit` (full tree, not just `--omit=dev`) now reports **0
  vulnerabilities**.

## What was done

- `zod` removed (unused); `react-router-dom` upgraded to v7; `npm audit --omit=dev`
  is clean.
- Dev/test/build toolchain upgraded to vite 8 / vitest 5 / coverage 5 /
  plugin-react 6; the full `npm audit` is now clean too.
- The full gate is `npm run verify:full` (format, lint, typecheck, coverage,
  build); E2E is `npm run e2e`. Both stayed green across every upgrade.

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
