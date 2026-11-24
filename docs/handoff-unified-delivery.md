# Handoff — PR #29 follow-up и зависимый supplier inbox UI

## Статус PR #29

- PR [#29](https://github.com/AisaKenzhi/horeca-marketplace/pull/29) открыт и не слит. Head-ветка: `feat/horeca-unified-delivery-2026-11-24`; base: `feat/product-ready-tenant-foundation-2026-11-23` @ `41e47ec57e76b541c21970bacf349366db08a892`.
- Проверенный code SHA пяти follow-up исправлений: `a816f8b06d1e7c1618d306fc745022bf7931c993`. На последней удалённой проверке (2026-11-25 00:04 CET) `git ls-remote` и GitHub API совпали с этим SHA; PR был открыт на этом head.
- Все шесть требуемых check-runs на code SHA `a816f8b` успешны; полный набор наблюдался в двух CI runs: lint/typecheck/unit/build, Chromium desktop/mobile E2E и ephemeral Supabase/pgTAP/PostgREST.
- Пять исправлений уже закоммичены и отправлены обычным push. Не повторять их commit/push и не пытаться отправлять этот diff заново. Эта handoff-правка меняет только данный документ; merge и deploy запрещены.
- Перед любыми будущими изменениями в PR #29 проверять фактический remote head заново. Не использовать устаревший SHA из предыдущих инструкций как условие продолжения.
- Изменения выполнялись в отдельной worktree `/workspace/horeca-pr29-followup-2026-11-24`. Исходная `/workspace/horeca-marketplace` не изменялась; её untracked `docs/task-master-unified-delivery.md` сохранён.

## Пять follow-up исправлений

1. Добавлены immutable snapshots buyer location name/address/delivery zone в procurement request: backfill текущих локальных запросов, trigger на insert и `FOR SHARE` lock при создании snapshot. Старый запрос больше не читает изменяемый адрес локации.
2. SQL worker/public wrapper buyer workflow-list теперь возвращает `created_at`; TypeScript contract и тест типа согласованы.
3. Loopback-only PostgreSQL smoke проверяет два одновременных supplier accept/reject с одинаковым `expectedVersion=1`: ровно один успех и один SQLSTATE `40001`, итоговую версию/статус, один audit event и один idempotency receipt. Ранее существующая гонка двух buyer submits сохранена.
4. Добавлены component/E2E проверки buyer location edit/delete и supplier display-name edit, включая ограничения ролей и клавиатурный сценарий. Playwright покрывает desktop/mobile через четыре management-теста.
5. Roadmap, handoff и workflow contract актуализированы: фактическая PR/base ветка, семь публичных workflow RPC, семь pgTAP файлов, ограничения и проверенные локальные результаты. Устаревший раздел о трёх независимых coder streams удалён.

## Проверки первого этапа

- `npm run verify:full` пройден: форматирование, lint, TypeScript, coverage и production build; 285 тестов прошли. Coverage: 85.13% statements, 77.38% branches, 91.04% functions, 88.62% lines.
- Lint: 0 ошибок; остались два ранее существовавших Fast Refresh предупреждения в `src/app/store.tsx`.
- `npm run e2e:ci` — 45 passed, 3 skipped; включает management UI desktop/mobile и accessibility gate. Targeted `e2e/account-management.spec.ts` — 4 passed.
- `node --check scripts/supabase-buyer-request-concurrency-smoke.mjs` и `git diff --check` прошли.
- В `supabase/tests` семь pgTAP suites. Они и concurrency smoke не запускались локально: Supabase CLI не нашёл Docker/Podman. Эквивалентные проверки ephemeral Supabase прошли в required CI; hosted/live DB не использовалась.

## Отдельный supplier inbox UI — текущий этап

- После зелёного CI старая UI-ветка `feat/supplier-suborder-inbox-ui-2026-11-24` @ `f4933840df373f07a4cae9333ab659e3d526bef7` была сравнена read-only. Её общий diff с обновлённой веткой нельзя переносить целиком; переносить можно только выбранные presentation/RPC-client patterns после адаптации.
- Создана отдельная worktree `/workspace/horeca-supplier-inbox-ui-2026-11-25` и ветка `feat/supplier-suborder-inbox-ui-2026-11-25`, изначально от code SHA `a816f8b`. Inbox-изменения здесь ещё в работе; commit, push и dependent PR ещё не созданы.
- Scope строго frontend-only: использовать только существующие публичные RPC; не менять backend/state machine/БД и не добавлять RPC, миграции, moderator role, реальные уведомления, закупки, резервирование, оплату, доставку или production side effects.
- Текущий публичный supplier list RPC отдаёт только текущее состояние: статус, версии, действующие условия/строки, причину, deadline и `updated_at`. Private audit events не доступны через публичный read endpoint. Интерфейс должен явно называть это текущим состоянием по данным API, а не полной историей решений; отсутствующие события не реконструировать и не выдумывать.
- Продолжить component/E2E проверки tenant/role boundaries, loading/error/empty, accept/reject/propose, быстрых повторных кликов, сохранения idempotency key при идентичном повторе, stale-conflict refresh и клавиатурной доступности. После проверок — обычный push только новой feature-ветки, отдельный dependent PR с base на фактическую head-ветку PR #29 и ожидание его CI. Оба PR оставить открытыми, не merge и не deploy.

## Не подключалось и не выполнялось

`main`, hosted/live DB, deploy, реальные заказы, уведомления, платежи, доставка и production data. В UI-этапе не добавляются база или backend-изменения.
