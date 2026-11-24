# Roadmap — P0 hardening follow-up

Statuses describe the **local** implementation and its synthetic-data tests only
(`AGENTS.md`, "Honesty about what tests prove"). They are not a claim about
staging, production, real demand or legal validity. Nothing here authorises a
deploy, a public resource or contact with a third party.

## A — P1 hardening (another agent, in progress)

- [ ] Idempotency keys must be per operation: `submit-${membership}-${nowIso}`,
      `reorder-...` and `import-...` currently use the constant `DEMO_NOW`, so a
      legitimate second operation replays the first result.
- [ ] CSV import: enforce `IMPORT_LIMITS.maxBytes`, compare every written field
      in `resolveImportRows` (packaging, availability, category), and make the
      in-file duplicate-SKU preview agree with the atomic apply.
- [ ] Unit-price sorting must use `compareUnitPrices` and never subtract prices
      with different `baseUnit` values.
- [ ] Wire `VITE_STALENESS_HOURS` into `computeCart` and `submitBasket`, not just
      the catalog.
- [ ] i18n: `kk: ru` is a scaffold and many UI strings are hard-coded.
- [ ] Remove unsafe raw read access (`getState`, `getParent`, `subordersOf`,
      `locationsForOrg`) from the UI boundary; keep all reads tenant-checked in
      the repository.
- [ ] Resolve documentation contradictions about the public demo and obtain
      explicit owner approval for commit + target + mode; `AGENTS.md` hard limits
      still apply.
- [ ] Extend the axe gate to `/catalog`, the buyer decision form and the
      receiving form; the current spec labels Home as "catalog".

## B — P2 hardening (completed in this pass)

- [x] Typed error codes: money, lifecycle and revision failures now use the
      `AppError` catalogue instead of raw `Error` (no more generic `internal`).
- [x] Domain input boundaries: safe-integer money, revision line price/quantity
      validation, supplier identity check, non-positive snapshot quantity
      rejected, decision duplicates scoped by suborder + revision.
- [x] Repository boundaries: `proposeChange` rejects offers outside the
      suborder, `confirmSuborderNoChange` reports a missing revision,
      `recordReceipt` validates lines/discrepancies and honours
      `idempotencyKey`, `addToList` is duplicate-safe, notification reads are
      owner-checked and audited once.
- [x] Generated ids skip ids already present anywhere in state, including
      nested basket lines (`bl-1` collision with the seed fixed).
- [x] `BrowserStore` keeps a full in-memory mirror when writes fail and rejects
      non-object persisted JSON.
- [x] UI: `min`/`step` come from MOQ/order step, basket quantity can be cleared
      and retyped, repository errors go through `toSafeError`, supplier proposal
      "before" values come from the current revision, internal ids removed from
      user-facing labels, duplicate demo banner and dead JSX removed, operator
      money formatted through `MoneyText`.
- [x] CI: production dependency audit gate (`npm audit --omit=dev`) in both
      workflows.
- [x] Local demo script uses a separate web root so re-running it cannot wipe a
      live domain demo.
- [x] Verification (local level): `npm run verify`, `npm run format`,
      193 unit/component tests, 20 Playwright runs (desktop + mobile, axe),
      coverage 88.08 / 78.54 / 93.05 / 90.42 — all thresholds passed.

### Explicitly still open inside B

- [ ] Make `expectedVersion` a required argument on every concurrency-sensitive
      repository write and update all callers (all UI callers already pass it;
      tests still omit it in some places).
- [ ] Remove dead helpers (`priceDelta`, `describeAvailability`,
      `assertOperatorCannotEditTerms`, `submitPreview`) only after confirming
      the A pass does not reuse them.
- [ ] Decide product semantics for `priceValidUntil` before wiring it as a
      submit blocker; it is currently unused.

## Outside this roadmap

Product/owner decisions (city, segment, legal operator, monetisation, real
suppliers), staging and production launch gates remain open in
`docs/product-scope.md` and `docs/deploy-readiness.md`.
