# Task 3 — Supplier-suborder backend lifecycle и workflow

## Передача и исходная база

**Целевая база:** ветка `feat/product-ready-tenant-foundation-2026-11-23`, commit `46d2a4e7eaa5e713f78d43256b5c394c5a34c626`. Создай отдельную feature-ветку от этой базы. Если общая база изменилась, зафиксируй новый HEAD и переноси только свою работу; не сливай ветки самостоятельно.

Это самостоятельное задание. Продуктовый план — [`product-roadmap.md`](product-roadmap.md), текущие модель и security boundaries — [`product-scope.md`](product-scope.md), [`tenant-foundation.md`](tenant-foundation.md), [`../AGENTS.md`](../AGENTS.md).

**Состояние целевой базы:** при buyer submit сервер атомарно проверяет офферы, сохраняет buyer-facing `submitted` request и immutable line snapshots, создаёт закрытые внутренние supplier suborders и замораживает корзину. Supplier пока не видит и не обрабатывает свои suborders в persisted account workspace. Родитель остаётся request, а не подтверждённый заказ. Private schema не открыта Data API и не имеет клиентских grants. Эту существующую атомарную операцию и исходные snapshots нельзя ослаблять или переписывать.

Последний аудит базы: `npm run verify`, `npm run format`, `npm run e2e:ci` прошли; `npm audit` сообщил 0 уязвимостей. Стандартный `npm run e2e`: 22 pass и 18 skip без mock-конфигурации; `e2e:ci`: 37 pass и 3 ожидаемых skip. Проверенное окружение не имело Docker/Podman, поэтому локальный pgTAP в нём не запускался. Всё это — только локальные результаты.

## Обязательный preflight: незавершённые ветки

До проектирования и написания кода изучи два отдельных, не включённых в целевую базу изменения:

- `feat/supplier-suborder-workflow-2026-11-24`, ссылка/commit `8424cbdf` — supplier suborder workflow;
- `feat/supplier-suborder-inbox-ui-2026-11-24`, ссылка/commit `f493384` — supplier inbox UI.

Сверь доступные refs и рабочие копии, вычисли base/merge-base относительно `46d2a4e`, изучи commit history и diff, прогоняй review с точки зрения доменных инвариантов, tenant isolation, RLS/grants, RPC security, идемпотентности, конкурентности, совместимости миграций и тестового покрытия. **Не считай ни одну ветку интегрированной и не полагайся на её код или UI как на состояние текущей базы.** Спецификация [`/workspace/horeca-marketplace-supplier-inbox/docs/supplier-suborder-workflow.md`](../../horeca-marketplace-supplier-inbox/docs/supplier-suborder-workflow.md) тоже находится вне основной базы: используй её как кандидатный дизайн, а не как утверждённую часть продукта.

В начале работы запиши краткий review-результат: что в ветках есть, что годится, что устарело/конфликтует, какие тесты запускались, какие риски найдены. Если refs отсутствуют или commit не соответствует ожидаемой работе, укажи это и продолжай только с подтверждённой спецификацией/своей реализацией. Если используешь код, переноси его только в свою задачу/ветку после review и rebase/cherry-pick с сохранением исходных веток; не переписывай и не интегрируй опубликованные ветки напрямую. Перед повторным использованием повторно проверь полный diff уже относительно целевого base.

## Цель

Добавить защищённый серверный lifecycle для внутренних supplier suborders: поставщик может явно принять/отклонить свою подветку или предложить новую версию условий; покупатель может явно принять/отклонить именно предложенную версию. Сохраняются неизменность исходного buyer request, изоляция веток и организаций, атомарность, идемпотентность, конкурентная защита и append-only audit. Это workflow локальной заявки, а не автоматическое создание коммерчески принятого заказа.

## Требуемый функциональный контракт

Перед реализацией зафиксируй canonical TypeScript contract статусов, команд, receipt и безопасных ошибок. Кандидатный контракт в supplier workflow spec задаёт следующие переходы:

| Состояние                 | Явное действие                                                       | Результат                 |
| ------------------------- | -------------------------------------------------------------------- | ------------------------- |
| `awaiting_supplier`       | поставщик принимает                                                  | `supplier_accepted`       |
| `awaiting_supplier`       | поставщик отклоняет с причиной                                       | `supplier_rejected`       |
| `awaiting_supplier`       | поставщик предлагает новую версию с причиной и будущим сроком ответа | `awaiting_buyer_decision` |
| `awaiting_buyer_decision` | покупатель принимает текущую `termsVersion`                          | `buyer_accepted`          |
| `awaiting_buyer_decision` | покупатель отклоняет текущую `termsVersion` с причиной               | `buyer_rejected`          |

Терминальные ответы не допускают нового перехода. Молчание не является согласием. Если после review контракт меняется, объясни изменение и зафиксируй его в типах/документации и тестах до реализации.

Для proposal сохраняй неизменяемый полный snapshot строк конкретного suborder: каждая исходная строка ровно один раз; proposal должен менять хотя бы quantity или price. Не меняй исходные product/pack/currency snapshots и не конвертируй валюту. `workflowVersion` — optimistic concurrency token, увеличиваемый после успешной команды; `currentTermsVersion` меняется только при новой версии условий. Buyer decision обязана совпадать одновременно с ожидаемой workflow version и точной terms version. Причина rejection/proposal обязательна. Дедлайн, если используется, хранится и показывается как заявленный срок ответа, но не создаёт автоматическое истечение, таймер или решение; поведение после дедлайна остаётся отдельным бизнес-решением.

## Объём работ

1. Изучить preflight refs выше и затем описать реализацию/миграционный план, не меняющий существующий buyer submit contract без необходимости.
2. Реализовать narrow public RPC/API surface и закрытые серверные workers для:
   - просмотра supplier-ом только собственных подзаказов;
   - buyer просмотра workflow подзаказов только собственного request;
   - supplier accept/reject/propose revised terms;
   - buyer accept/reject конкретной актуальной версии proposal.
3. Supplier actions разрешать только действующим членам правильного supplier tenant с ролями `owner`, `admin` или `order_operator`. Buyer view — только членам buyer tenant. Buyer decision разрешать `owner`, `admin` или `buyer`; `viewer` может только читать. Проверять tenant и object relationship серверно; чужие IDs отвечают безопасно и не раскрывают чужой объект.
4. Все изменения должны быть одной транзакцией: блокировка workflow row, проверка `expectedVersion`, валидация перехода, запись состояния/версии, immutable event/audit и idempotency receipt. При ошибке не оставлять частичную запись.
5. Ограничить idempotency key действующей организацией и командой/payload. Одинаковый ключ с тем же payload возвращает исходный receipt/replay; тот же ключ для иного действия/payload — типизированный конфликт. Параллельные команды с одной версией: один допустимый результат, остальные безопасно получают version conflict; никто не перезаписывает выигравшее действие.
6. Сохранять события, proposal versions, version lines и receipts append-only; запретить UPDATE/DELETE обычным клиентским ролям и защитить даже от ошибочной privileged mutation согласно существующим шаблонам проекта. Не изменять исходные buyer request и immutable snapshots.
7. Если миграция нужна, держать её в доменной области workflow и обеспечить обратимую/безопасную инициализацию существующих локальных supplier suborders. Рассмотреть миграционный trigger/инициализацию вместе с текущей транзакцией, чтобы ни один новый suborder не остался без workflow. Не открывать `private` schema в Data API.
8. Обновить typed client contract после review миграции в рамках согласованной интеграции; не менять generated `database.types.ts` параллельно и не создавать конфликт с supplier/catalog миграциями Task 2.
9. Подготовить краткую интеграционную заметку для будущего buyer/supplier UI: допустимые статусы/команды, ошибки, версии и гарантии read/write. Этот task не строит UI.

В candidate spec приведены возможные RPC names: `list_supplier_suborders`, `list_buyer_supplier_suborder_workflows`, `accept_supplier_suborder`, `reject_supplier_suborder`, `propose_supplier_suborder_version`, `accept_buyer_supplier_suborder_version`, `reject_buyer_supplier_suborder_version`. Считай их предложением, а не обязательным именованием: сначала проверь API conventions целевой базы и candidate branches, затем выбери минимальную совместимую поверхность.

## Безопасность, инварианты и границы

- Предпочитай `SECURITY INVOKER`; если необходим `SECURITY DEFINER`, используй пустой/pinned `search_path`, полную квалификацию имён, явные grants и минимальные права. Public wrappers — только узкие RPC; прямого client grant к private tables нет.
- Не доверяй UI, user metadata, переданному organization ID или client-side ownership. Валидируй authenticated principal, membership role, tenant и реальную связь suborder/request в БД.
- Сохраняй отдельные suborders: supplier не видит buyer cart/личные сведения или другие supplier branches сверх минимально необходимого workflow-контекста. Buyer читает только branches собственного parent request.
- Используй типизированные ошибки; наружу не отдавай SQL, stack traces, секреты, лишние IDs или чужие данные. Кандидатные SQLSTATE из spec: `42501` unauthorized, `P0002` not found in accessible tenant, `23514` invalid input, `40001` version conflict, `55000` invalid transition, `P0001` idempotency conflict — сверить с текущими conventions.
- Не меняй parent request `submitted`, исходные snapshots, supplier catalog offers или buyer cart logic. Ответ поставщика/покупателя на workflow не равен заказу платформы или подтверждённой закупке.
- Документируй доказательства как local; hosted и production не подключать.

## Критерии приёмки

- Выполнен и передан сравнительный review веток `8424cbdf` и `f493384` относительно целевой базы, с обоснованием повторного использования или отказа от него. Ни одна ветка не названа уже интегрированной.
- Contract статусов/команд/ошибок типизирован и согласован с существующей моделью. Все допустимые переходы работают, запрещённые и терминальные переходы детерминированно отклоняются.
- Supplier не может прочитать или изменить подзаказ другого supplier; buyer не может прочитать подзаказ другого buyer tenant; `viewer` не выполняет buyer decision; неавторизованный пользователь не получает доступ. Проверены anonymous, поддельные ID, неверная роль и границы между соседними branches.
- Исходные buyer snapshots и родительский request остаются неизменными; новые условия хранятся отдельной versioned записью и требуют явного buyer decision на точный terms version.
- Replays не создают дубли; повтор ключа с другим payload отклоняется; конкурентные команды не теряют обновления; любой simulated failure откатывает все связанные записи.
- Audit/events/version snapshots/idempotency receipts append-only и атомарны; grants/RLS/RPC не расширяют API exposure.
- Новые SQL-тесты охватывают success, invalid transition, permissions, tenant isolation, stale expected version, stale terms version, replay/conflicting key, concurrent race, rollback, snapshot immutability и миграцию существующих локальных строк.
- Существующая атомарная отправка buyer request остаётся зелёной; соседние supplier branches не загрязняются действием над одной веткой.

## Тестирование и локальная проверка

Добавь domain/contract tests и pgTAP tests; при необходимости — локальные concurrency/integration tests. Прогони:

```bash
npm run verify
npm run format
npm run e2e:ci
```

Проверь актуальный mobile buyer E2E, который уже есть в целевой базе; не создавай отдельную повторную интеграцию. При доступном Docker/Supabase выполняй только локально:

```bash
npx supabase db reset
npx supabase test db
```

Также проверь diff миграций и grants. Если локальная среда не поддерживает pgTAP, отметь это явно, подготовь тесты для локального CI и не заявляй SQL/security assurance как проверенный. Не подключай hosted Supabase и не используй production credentials/data. Все fixtures синтетические.

## Явно не входит (non-goals)

- Supplier inbox UI и buyer UI принятия proposal; ветку `f493384` только review-ить, не интегрировать в этот backend task.
- Новая buyer request submit/RPC логика, переписывание snapshots или изменение статуса родителя на `accepted`.
- Автоматическое принятие/отклонение по молчанию, автоматический таймер/expiry, новые правила после response deadline.
- Email/SMS/push/WhatsApp/Telegram и любые реальные уведомления/контакты.
- Запас/резервирование, внешнее размещение supplier order, исполнение/отмена/приёмка/доставка.
- Оплата, расчёты, счета, налоги, возвраты, комиссия и юридическая трактовка принятия.
- Реальные buyer/supplier данные, live database, staging/production, deploy или внешние side effects.
- Самостоятельный commit/push/PR/merge или изменение чужих/shared branches.

## Что передать по завершении

Передай: (1) краткое сравнение workflow/UI branches с base и решение по reuse, (2) контракт статусов и RPC/API, (3) список миграций и security grants/RLS, (4) тесты и точные результаты команд, (5) известные ограничения и оставшиеся бизнес-решения. Если Docker/pgTAP недоступен, напиши это явно. Подтверди, что исходный buyer request и все внешние системы остались нетронутыми.
