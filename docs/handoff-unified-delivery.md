# Handoff — PR #29: follow-up и отдельный supplier inbox UI

## Текущий PR и границы

- PR: [#29](https://github.com/AisaKenzhi/horeca-marketplace/pull/29), head-ветка `feat/horeca-unified-delivery-2026-11-24`.
- Target/base: `feat/product-ready-tenant-foundation-2026-11-23` @ `41e47ec57e76b541c21970bacf349366db08a892`.
- Проверенный на старте follow-up head: `a20e67128bf8f06ea897fd95fb0438f47277b464`. Перед push сверить фактический remote head ещё раз; при любом несовпадении — остановиться.
- Изменения выполняются в отдельной worktree `/workspace/horeca-pr29-followup-2026-11-24`. Исходная `/workspace/horeca-marketplace` не изменялась; её untracked `docs/task-master-unified-delivery.md` оставлен нетронутым.
- PR остаётся открытым; изменения отправляются только обычным push после final head check. Merge и deploy не выполнять.

## Пять follow-up исправлений

1. Добавлены immutable snapshots buyer location name/address/delivery zone в procurement request: backfill текущих локальных запросов, trigger на insert и `FOR SHARE` lock при создании snapshot. Старый запрос больше не читает изменяемый адрес локации.
2. SQL worker/public wrapper buyer workflow-list теперь возвращает `created_at`; TypeScript contract и тест типа согласованы.
3. Loopback-only PostgreSQL smoke теперь проверяет два одновременных supplier accept/reject с одинаковым `expectedVersion=1`: ровно один успех и один SQLSTATE `40001`, итоговую версию/статус, один audit event и один idempotency receipt. Ранее существующая гонка двух buyer submits сохранена.
4. Добавлены прямые component/E2E проверки buyer location edit/delete и supplier display-name edit, включая ограничения ролей и клавиатурный сценарий. Playwright покрывает desktop/mobile через четыре management-теста.
5. Roadmap, handoff и workflow contract актуализированы: фактическая PR/base ветка, семь публичных workflow RPC, семь pgTAP файлов, ограничения и проверенные локальные результаты. Устаревший раздел о трёх независимых coder streams удалён.

## Локальные проверки

- `npm run verify:full` — пройден: форматирование, lint, TypeScript, coverage и production build; 285 тестов прошли. Coverage: 85.13% statements, 77.38% branches, 91.04% functions, 88.62% lines.
- Lint: 0 ошибок; остались два ранее существовавших Fast Refresh предупреждения в `src/app/store.tsx`.
- `npm run e2e:ci` — 45 passed, 3 skipped; включает management UI desktop/mobile и accessibility gate.
- Targeted `e2e/account-management.spec.ts` — 4 passed.
- `node --check scripts/supabase-buyer-request-concurrency-smoke.mjs` и `git diff --check` — прошли.
- В `supabase/tests` семь pgTAP suite. Они и concurrency smoke локально не запускались: `npx supabase status` сообщил, что Docker/Podman отсутствует. Не подключаться к hosted/live DB; требуется ephemeral Supabase в required CI.

## Следующий порядок

1. Выполнить final diff/status и проверить, что исходная worktree и её untracked файл не затронуты.
2. Снова проверить GitHub API head PR #29. Если SHA не равен `a20e67128bf8f06ea897fd95fb0438f47277b464`, остановиться и не отправлять изменения.
3. При неизменном SHA закоммитить follow-up и выполнить обычный push только в фактическую head-ветку PR #29, без force-push. Дождаться зелёного required CI; не merge.
4. Только после зелёного required CI read-only сравнить `feat/supplier-suborder-inbox-ui-2026-11-24` @ `f4933840df373f07a4cae9333ab659e3d526bef7` с обновлённым workflow contract. Не переносить старый diff вслепую.
5. Затем создать отдельную ветку от исправленного PR #29 HEAD и отдельный dependent PR в head-ветку PR #29. Inbox UI — только собственные supplier suborders, текущие условия/версии и история решений; действия используют `expectedVersion`, idempotency key и stale-conflict recovery. Не менять backend state machine/БД, не добавлять moderator role и реальные уведомления/закупки/резервы/платежи/доставку.
6. Проверить роли/tenant boundary, повторные клики, loading/error/empty, клавиатурную доступность, component/E2E и CI. Оба PR оставить открытыми; не merge и не deploy.

## Не подключалось и не выполнялось

`main`, hosted/live DB, deploy, реальные заказы, уведомления, платежи, доставка, supplier/buyer production data. Inbox UI — отдельный этап и пока не начат. Отсутствие локального Docker/Podman — единственное подтверждённое ограничение локального SQL gate; результат должен поступить от required CI.
