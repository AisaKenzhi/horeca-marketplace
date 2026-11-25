# Handoff — unified delivery, PR #29–#32 и текущие блокеры

**Сверено с remote GitHub:** 2026-11-25. Этот handoff фиксирует текущий GitHub статус и заменяет более ранние строки ниже по истории, в которых PR #29/#30 ещё были открыты. Для очередности работ и статусов задач см. [`product-roadmap.md`](product-roadmap.md).

## Текущий статус integration branch

- Проверенная code-база integration branch `feat/horeca-unified-delivery-2026-11-24` — `fa6578dc72b4642676aa4e4f568cf99235f887af` (merge PR #32). Docs-only PR #31 может продвинуть branch новыми документационными commit без изменения кода; перед следующей задачей обязательно перепроверить фактический remote HEAD.
- PR [#29](https://github.com/AisaKenzhi/horeca-marketplace/pull/29) закрыт после merge; merge SHA `83bae73021cc580a6d656691448db82c1e190b18`. Base PR: `feat/product-ready-tenant-foundation-2026-11-23`; source head был integration branch @ `6e9144c4c67a7e19d27fe3f40e7c044eaff3420c`. Все три проверенных CI checks на merge SHA успешны: lint/typecheck/unit/build, Chromium desktop/mobile E2E и ephemeral Supabase/pgTAP/PostgREST.
- PR [#30](https://github.com/AisaKenzhi/horeca-marketplace/pull/30) закрыт после merge в integration branch; merge SHA `ef40c1bf5a0cc8af34dd29a1f66c53e7d61f7b97`. Base был `feat/horeca-unified-delivery-2026-11-24` @ `6e9144c4c67a7e19d27fe3f40e7c044eaff3420c`; source head `feat/supplier-suborder-inbox-ui-2026-11-25` @ `cb3c57bf50baf9e045b01c01208af78ba6641865`.
- На source head PR #30 checks были зелёными. На merge SHA `ef40c1b` [CI run 45516817340](https://github.com/AisaKenzhi/horeca-marketplace/actions/runs/45516817340) упал на трёх success-flow тестах `BuyerProcurementListsPanel.test.tsx`: фикстуры имели `price_observed_at`/`availability_observed_at = 2026-11-24T00:00:00.000Z` (старше 24-часового порога) и `price_valid_until = 2026-11-25T00:00:00.000Z` (истёкло к CI в 00:17 UTC). Продуктовая блокировка была корректной; `Map.groupBy is not a function` в Vitest reporter на Node 20.19 — вторичная ошибка после assertions. На merge SHA PR #30 E2E и ephemeral Supabase прошли, build был пропущен.
- Отдельный test-only PR [#32](https://github.com/AisaKenzhi/horeca-marketplace/pull/32) изменил только эти test fixtures и merged в integration с SHA `fa6578dc72b4642676aa4e4f568cf99235f887af`; PR checks были зелёными. На merge SHA успешно завершились post-merge [CI run 45520660167](https://github.com/AisaKenzhi/horeca-marketplace/actions/runs/45520660167) и [ephemeral Supabase run 45520660132](https://github.com/AisaKenzhi/horeca-marketplace/actions/runs/45520660132). Это закрывает CI-BASE-01 и SUP-INBOX-01; изменения buyer UI/доменной логики не вносились.
- На момент проверки `main` был `1980bcf2ef3aa97d9351697d01f2401547d36e17`; PR #29–#32 не направлялись туда. Production, hosted/live DB, deploy и реальные операции не затрагивались.
- Следующий запланированный buyer task — Buyer proposal/current-terms UI. Он остановлен по просьбе Айсы: implementation commit и PR отсутствуют. Не возобновлять без отдельного явного разрешения владельца.
- Docs-only PR [#31](https://github.com/AisaKenzhi/horeca-marketplace/pull/31) содержит только `AGENTS.md`, `docs/product-roadmap.md` и этот handoff и направляется исключительно в integration feature branch. Ветка PR обычным merge синхронизирована с код-базой `fa6578d`; фактические base/head, required checks, mergeability и итоговое состояние всегда проверять по live PR. Не сливать при красном required check и не менять target на `main`.

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

PR #30 source head CI был green; после merge выявилась ошибка устаревших test timestamps, а reporter `Map.groupBy` был вторичным. Отдельный test-only PR #32 исправил fixtures и merged в integration на `fa6578d`; post-merge CI и ephemeral Supabase прошли. Это не меняло buyer UI или доменную логику и закрывает supplier inbox integration gate. Docs-only PR #31 синхронизирован с этой integration code-базой обычным merge; держать его diff только документационным, проверять live required checks и сливать только в integration при зелёных проверках и корректных base/head. Buyer proposal UI остаётся на паузе.

## Сохранность worktrees и безопасные границы

- Исходный `/workspace/horeca-marketplace` не использовался для этой правки; его незакоммиченный `docs/task-master-unified-delivery.md` сохранён.
- Не переписывать и не отправлять повторно уже merged PR #29/#30. Перед любой дальнейшей работой заново проверить remote integration HEAD и PR status.
- Все новые изменения — отдельная ветка и PR в текущую integration feature branch; после review и green required checks слить туда без накопления готовых branches.
- `main`, live/hosted DB, deploy и любые реальные внешние side effects требуют отдельного разрешения Айсы.
