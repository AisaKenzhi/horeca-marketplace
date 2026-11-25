# Handoff — unified delivery, PR #29–#32 и текущие блокеры

**Сверено с remote GitHub:** 2026-11-25. Этот handoff фиксирует текущий GitHub статус и заменяет более ранние строки ниже по истории, в которых PR #29/#30 ещё были открыты. Для очередности работ и статусов задач см. [`product-roadmap.md`](product-roadmap.md).

## Текущий статус integration branch

- Integration branch: `feat/horeca-unified-delivery-2026-11-24`, remote HEAD `ef40c1bf5a0cc8af34dd29a1f66c53e7d61f7b97`.
- PR [#29](https://github.com/AisaKenzhi/horeca-marketplace/pull/29) закрыт после merge; merge SHA `83bae73021cc580a6d656691448db82c1e190b18`. Base PR: `feat/product-ready-tenant-foundation-2026-11-23`; source head был integration branch @ `6e9144c4c67a7e19d27fe3f40e7c044eaff3420c`. Все три проверенных CI checks на merge SHA успешны: lint/typecheck/unit/build, Chromium desktop/mobile E2E и ephemeral Supabase/pgTAP/PostgREST.
- PR [#30](https://github.com/AisaKenzhi/horeca-marketplace/pull/30) закрыт после merge в integration branch; merge SHA `ef40c1bf5a0cc8af34dd29a1f66c53e7d61f7b97`. Base был `feat/horeca-unified-delivery-2026-11-24` @ `6e9144c4c67a7e19d27fe3f40e7c044eaff3420c`; source head `feat/supplier-suborder-inbox-ui-2026-11-25` @ `cb3c57bf50baf9e045b01c01208af78ba6641865`.
- На source head PR #30 были зелёными CI и ephemeral database checks. На merge SHA `ef40c1b` E2E и ephemeral Supabase checks успешны, но workflow [CI run 45516817340](https://github.com/AisaKenzhi/horeca-marketplace/actions/runs/45516817340) завершился failure: format/lint/typecheck прошли; unit/component suite отметил три теста в `BuyerProcurementListsPanel.test.tsx`: `saves an organization-owned delivery point and reports when available checks pass`, `requires explicit buyer confirmation and displays a non-accepted request snapshot`, `keeps per-supplier reasons and the idempotency key after a rejected submit`. В CI в 00:17 UTC 2026-11-25 общие фикстуры этих success-flow тестов содержали `price_observed_at`/`availability_observed_at = 2026-11-24T00:00:00.000Z` (старше установленного 24-часового порога) и `price_valid_until = 2026-11-25T00:00:00.000Z` (истёк 17 минут назад). Доменный код поэтому корректно блокировал корзину; локальный повтор на Node 24 подтвердил assertion failures. Ошибка Vitest reporter `TypeError: Map.groupBy is not a function` на Node 20.19 произошла уже после них и только скрыла подробные CI assertions. **PR #30 физически merged, но task/integration gate нельзя считать DONE, пока полный требуемый CI не станет зелёным на актуальном merge result.**
- На момент проверки `main` был `1980bcf2ef3aa97d9351697d01f2401547d36e17`. PR #29/#30 не были направлены в `main`; production, hosted/live DB, deploy, реальные заказы, уведомления, платежи и доставка не подключались и не запускались.
- Следующий запланированный buyer task — Buyer proposal/current-terms UI. Он остановлен по просьбе Айсы: implementation commit и PR отсутствуют. Не возобновлять без отдельного явного разрешения владельца.
- Docs-only PR [#31](https://github.com/AisaKenzhi/horeca-marketplace/pull/31): base `feat/horeca-unified-delivery-2026-11-24` @ `ef40c1bf5a0cc8af34dd29a1f66c53e7d61f7b97`, head `01cdfc7067e27fd8853b3967ab54c823298a1089`. Из 6 checks четыре зелёные (оба E2E и обе ephemeral Supabase), два unit/typecheck/build CI entries красные из-за baseline timestamp regression; PR не слит.
- Code-fix PR [#32](https://github.com/AisaKenzhi/horeca-marketplace/pull/32): отдельная branch `fix/buyer-test-freshness-ci-2026-11-25` от того же base SHA `ef40c1bf5a0cc8af34dd29a1f66c53e7d61f7b97`, head `bce97984a336c004366ed131c2c8d4134059e306`; меняет только buyer test fixtures. На последней проверке требуемые GitHub checks ещё выполнялись. Локально targeted suite — 10 passed, `npm run verify:full` — 309 passed и format/typecheck/coverage/build green (два прежних Fast Refresh warnings), `npm run e2e:ci` — 47 passed / 3 skipped. Не сливать PR #32 до полного green и повторной проверки base; после его merge перепроверить PR #31, при необходимости обновить только docs branch обычным push, дождаться green checks и лишь затем слить #31 в эту integration branch.

## Scope и ограничения PR #29

PR #29 объединил buyer/account follow-up и backend supplier-suborder workflow. В частности:

1. Buyer request сохраняет immutable snapshots buyer location name/address/delivery zone; location lock и trigger защищают snapshot от изменения исходной локации.
2. Workflow list SQL worker/public wrapper и TypeScript return type согласованы по `created_at`.
3. PostgreSQL concurrency smoke сохраняет тест повторного buyer submit и добавляет supplier accept/reject гонку на одинаковом `expectedVersion`: один успешный переход, один serialization conflict, один audit event и idempotency receipt.
4. Component/E2E покрывают buyer location edit/delete и supplier display-name edit, включая роли, ошибки и keyboard path.
5. Backend supplier-suborder workflow использует private tables, deny-by-default grants, семь публичных RPC, immutable events/receipts, version checks, idempotency и audit.

PR #29 не включал moderation queue/доверенную platform-moderator роль, account/org deletion и retention, полноценную `kk` локализацию, supplier inbox UI, реальные заказы, автоматические уведомления, резервирование, payment, invoices/tax, delivery, hosted/staging/production setup.

### Проверки PR #29

- `npm run verify:full`: format/lint/typecheck/coverage/build green; 285 tests; coverage 85.13% statements, 77.38% branches, 91.04% functions, 88.62% lines. Два ранее существовавших Fast Refresh warnings оставались без lint errors.
- `npm run e2e:ci`: 45 passed, 3 skipped; targeted `e2e/account-management.spec.ts`: 4 passed; axe accessibility gate included.
- `node --check scripts/supabase-buyer-request-concurrency-smoke.mjs` и `git diff --check` прошли.
- Локальный Supabase CLI не нашёл Docker/Podman; локальный pgTAP/concurrency smoke не запускался в worktree. Эквивалентные ephemeral Supabase/pgTAP/PostgREST checks были зелёными в required CI. Hosted/live DB не использовалась.

Эти результаты относятся к локальным synthetic тестам и CI disposable environment. Они не подтверждают hosted/production работу, реальный спрос, юридическую пригодность или коммерческую модель.

## Scope и ограничения PR #30

PR #30 добавил frontend-only supplier suborder inbox поверх существующего RPC contract. UI показывает собственные supplier suborders и доступные через API текущие условия/версии; он не добавляет backend state transitions, DB migrations, moderator role, notifications, reservation, payment, delivery или production side effects.

Семь публичных workflow RPC и таблицы audit/version/receipts остаются прежними. Private audit events не доступны через public list endpoint: интерфейс не должен называть доступный снимок полной историей решений и не должен реконструировать отсутствующие события.

PR #30 source head CI проверен и был green. На merge SHA проблема воспроизведена: три success-flow теста использовали уже stale/expired абсолютные timestamps; отдельный reporter `Map.groupBy` error — вторичный. Текущая работа `CI-BASE-01` идёт в отдельном test-only PR #32 от свежего integration HEAD; дождаться полного green required checks, перед merge повторно сверить base/head. PR #31 остаётся отдельным docs-only PR и пока не слит, так как два CI entries красные. После merge PR #32 проверить/обновить #31 обычным push, дождаться зелёных checks и слить его только в текущую integration branch. Buyer proposal UI при этом остаётся на паузе; продуктовый UI/доменную логику менять не нужно.

## Сохранность worktrees и безопасные границы

- Исходный `/workspace/horeca-marketplace` не использовался для этой правки; его незакоммиченный `docs/task-master-unified-delivery.md` сохранён.
- Не переписывать и не отправлять повторно уже merged PR #29/#30. Перед любой дальнейшей работой заново проверить remote integration HEAD и PR status.
- Все новые изменения — отдельная ветка и PR в текущую integration feature branch; после review и green required checks слить туда без накопления готовых branches.
- `main`, live/hosted DB, deploy и любые реальные внешние side effects требуют отдельного разрешения Айсы.
