# Handoff — единая последовательная интеграция HoReCa Marketplace

## 1. Сдано

- **Buyer/account:** перенесён PR #28 (безопасные edit/delete buyer locations с проверкой FK-ссылок на корзины/запросы и typed `location_in_use`); модерация не имитировалась.
- **Supplier/catalog:** добавлен безопасный edit `display_name` профиля только для owner/admin (`grant update (display_name)`, статус проверки остаётся серверным). Operator review queue **не реализована** — нет доверенной серверной роли модератора.
- **Supplier-suborder workflow:** портирован review-ready backend из legacy-ветки `8424cbd`:private таблицы, deny-by-default grants, 7 публичных RPC, SECURITY DEFINER worker'ы с `search_path = ''`, immutable events/versions/receipts, `expectedVersion`, idempotency, append-only audit, полный immutable snapshot каждого proposal. Generated types дополнены всеми шестью RPC.
- **Docs:** роадмап получил раздел о единой последовательной интеграции; контракт workflow — `docs/supplier-suborder-workflow.md`; карта Task 1 — `docs/task-1-handoff.md`.

## 2. Git

- Target/base: `feat/product-ready-tenant-foundation-2026-11-23` @ `41e47ec57e76b541c21970bacf349366db08a892`.
- Integration branch: `feat/horeca-unified-delivery-2026-11-24`.
- Integration HEAD: `INTEGRATION_HEAD` (будет заменено на финальный SHA перед публикацией).
- Logical commits (в порядке):
  1. `80d2329` — port PR #28: buyer locations + Task 1 handoff map.
  2. `06a1ebe` — port supplier-suborder workflow backend (`8424cbd`).
  3. `049837e` — safe supplier display-name edit + adapter tests.
  4. `cecce45` — typed RPC surface в `database.types.ts`.
  5. docs/roadmap + этот handoff.
- PR: `PR_REFERENCE`. **PR оставлен открытым, не слит**; force-push и запись в общую ветку не выполнялись.

## 3. Disposition источников

| Источник                                                                                                          | Состояние на момент проверки                                  | Решение                                                                                                                                                                                      |
| ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PR #28 `coder-a/task1-locations-and-states` @ `bb95d9d`                                                           | OPEN, base target, mergeable=CLEAN, CI зелёный, **не в базе** | **ported** как `80d2329`; исходный PR не менялся/не закрывался                                                                                                                               |
| Task 2 branch/PR                                                                                                  | в refs и открытых PR не найдено                               | безопасная часть реализована локально; moderation — blocker                                                                                                                                  |
| Pete worktree `/workspace/horeca-marketplace-task3` и ветка `feat/supplier-suborder-backend-lifecycle-2026-11-24` | пути и ref в этом окружении отсутствуют                       | **blocked/unverified**: заявленные 290 тестов, 7 pgTAP и concurrency не перепроверены; чужих файлов не трогали                                                                               |
| `feat/supplier-suborder-workflow-2026-11-24` @ `8424cbd`                                                          | 1 commit от `56a630d`, 5 файлов, 1655 строк                   | **ported** как `06a1ebe` (domain, SQL migration, pgTAP, spec, тесты)                                                                                                                         |
| `feat/supplier-suborder-inbox-ui-2026-11-24` @ `f493384`                                                          | 2 commitа, 14 файлов, 3841 строка                             | **reviewed, rejected for this scope**: большой inbox UI (570 строк) и adapter (433) не портированы; интерфейсный контракт передан в `docs/supplier-suborder-workflow.md`, UI — следующий шаг |
| `origin/main` @ `1980bcf`                                                                                         | посторонний hardening-коммит                                  | не интегрирован                                                                                                                                                                              |

Чужие dirty worktree не обнаружены и не очищались; `git worktree list --porcelain` показывал только основной worktree.

## 4. Изменённые файлы и миграции

- `src/data/supabase/workspace.ts` + тест: `updateBuyerLocation`, `deleteBuyerLocation` (pre-check двух FK `ON DELETE RESTRICT`, typed `location_in_use`), `updateSupplierProfileDisplayName`.
- `src/features/account/AccountWorkspace.tsx`: manager-only edit/delete локаций и edit названия профиля, loading/empty/success/error состояния, безопасные confirmation.
- `src/data/supabase/database.types.ts`: 6 workflow RPC (`list_*`, `accept/reject/propose` supplier, `accept/reject` buyer).
- `supabase/migrations/20261124092945_supplier_suborder_workflow.sql`: private workflow tables (workflows, terms, term lines, events, idempotency); публичные SECURITY INVOKER RPC; internal SECURITY DEFINER worker'ы с пустым `search_path`; триггеры неизменяемости и инициализации workflow при вставке строки suborder; grants только `execute` на RPC. Роллбэк — forward-fix миграция, не редактирование истории.
- `supabase/tests/supplier_suborder_workflow.test.sql`: 7-й pgTAP набор (Tenant/role negative, version conflict, idempotency replay, immutability).
- `src/domain/supplierSuborderWorkflow.ts` + тест: typed состояния/переходы/ошибки, `expectedVersion` отдельно от `termsVersion`.
- Документы: `docs/product-roadmap.md`, `docs/supplier-suborder-workflow.md`, `docs/task-1-handoff.md`, этот файл.

## 5. Тесты (точные команды и результаты)

Baseline на `41e47ec` **до изменений**:

- `npm run verify:full` — exit 0, 270 tests, coverage 85.07 / 77.32 / 90.88 / 88.51, lint 0 errors (2 warnings), build OK.
- `npm run verify` — exit 0, 270 tests, build OK. `npm run format` — clean.
- `npm run e2e` — exit 0, **22 passed / 22 skipped** (ожидаемо без mock Supabase env).
- `npm run e2e:ci` — exit 0, **41 passed / 3 skipped** (2× неконфигурированный `/account`, 1× desktop-вариант мобильного smoke).
- `npm audit --audit-level=low` — 0 vulnerabilities.

Integration HEAD:

- `npm run verify:full` — exit 0, **279 tests**, coverage 85.17 / 77.45 / 91.04 / 88.67, lint 0 errors (2 warnings), build OK.
- `npm run verify` — exit 0, 279 tests. `npm run format` — clean.
- `npm run e2e` — exit 0, 22 passed / 22 skipped. `npm run e2e:ci` — exit 0, 41 passed / 3 skipped.
- `npm audit --audit-level=low` — 0 vulnerabilities.
- `npx supabase status` / `db reset` / `test db` — **не запускались локально**: Supabase CLI на машине отсутствует. 7 pgTAP наборов (включая новый workflow) должен прогнать CI workflow `Local Supabase database tests` на ephemeral local Postgres; до зелёного CI SQL-поведение локально **не подтверждено**.
- Ручная клавиатурная проверка: button-навигация по новым формам и `role="alert"` проверены через компонентные/E2Eassertions; полноценный ручной screen-reader проход **не выполнялся**. axe gate зелёный — это не сертификация доступности.

## 6. Открытые решения и blockers

- **Moderation authority:** в миграциях нет доверенной platform-moderator роли; client flag/user metadata/demo persona использовать нельзя. Нужна роль/authorization contract от владельца.
- **Invitation reason codes:** RPC возвращает `NULL` для истёкшей/отозванной/использованной ссылки и email-mismatch. Нужен read-only RPC от backend-владельца; точные причины в UI не имитируются.
- **Account/org deletion + retention:** FK `RESTRICT`, immutable snapshots и private suborders; нужен выбор владельца (юридический оператор, сроки, владелец данных).
- **kk-локализация:** `kk` = алиас `ru`; язык пилота не выбран.
- **Workflow UI:** backend и typed contract готовы; inbox/supplier response и buyer decision screens — отдельное решение, не включены.
- **Юридическое/коммерческое:** оператор, юрисдикция, налоги, документы, комиссия, оплата/возвраты, доставка, город/сегмент/категории, реальные участники — открыты; код их не выбирает.
- **После response deadline:** таймер/автоистечение и поведение после срока не придуманы.
- **Pete результаты:** непроверены из-за отсутствия worktree/ref.

## 7. Воспроизводимость и rollback

```bash
cd horeca-marketplace
git checkout INTEGRATION_HEAD
npm ci
npm run verify:full
npm run e2e:ci
npm audit --audit-level=low
# локальный Supabase (если CLI/Docker доступны):
npx supabase status        # подтвердить, что target — локальный стек
npx supabase db reset
npx supabase test db
```

Откат до базы до.merge: `git checkout 41e47ec` в отдельном worktree; integration branch удаляется после решения владельца. Миграция workflow — forward-fix, не редактирование history; при отмене branching просто не применяется.

## 8. Честная граница готовности

Только локальные/CI проверки на синтетических данных. Нет реальных поставщиков/покупателей, контактов, уведомлений, заказов, резервов, платежей, settlement, счетов, налогов, доставки, hosted DB writes, deploy или public launch. Зелёные локальные тесты не доказывают спрос, юридическую пригодность, безопасность hosted-контура или работу живых провайдеров. PR не слит.
