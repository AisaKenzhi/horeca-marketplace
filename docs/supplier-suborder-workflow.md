# Контракт supplier-suborder workflow

## Границы

Этот workflow хранит явные ответы поставщика и решение покупателя по конкретной версии условий внутреннего suborder. Он не изменяет родительский buyer request: тот остаётся `submitted`, а исходные снимки и строки корзины не переписываются. Согласование условий само по себе не создаёт подтверждённую закупку, резерв, оплату, счёт, доставку или внешнее сообщение.

## Состояния и версии

| Текущее состояние         | Разрешённое явное действие       | Результат                 |
| ------------------------- | -------------------------------- | ------------------------- |
| `awaiting_supplier`       | `supplier_accept`                | `supplier_accepted`       |
| `awaiting_supplier`       | `supplier_reject`                | `supplier_rejected`       |
| `awaiting_supplier`       | `supplier_propose_version`       | `awaiting_buyer_decision` |
| `awaiting_buyer_decision` | принять текущую `termsVersion`   | `buyer_accepted`          |
| `awaiting_buyer_decision` | отклонить текущую `termsVersion` | `buyer_rejected`          |

После терминального ответа повторный переход не разрешён. Система не выводит согласие из молчания и не принимает решение автоматически.

`workflowVersion` — токен конкурентного обновления; он увеличивается на 1 после каждого успешного действия. `currentTermsVersion` начинается с `1` и меняется только при предложении поставщика новой версии. Поэтому принятие/отклонение проверяет одновременно `expectedVersion` workflow и точный `termsVersion` предложения. Каждый новый proposal — полный неизменяемый снимок строк suborder: он должен включать каждую исходную строку ровно один раз и изменить хотя бы количество или цену. Товар, упаковка и валюта остаются привязаны к неизменяемому snapshot исходного buyer request; валюта не меняется и конвертации нет.

Цены в typed contract передаются десятичными строками, максимум 12 цифр до и 4 после десятичной точки. Количество каждой строки — целое от 1 до 1 000 000. Причина supplier reject/proposal обязательна (1–1000 символов). Proposal требует будущий `responseDeadlineAt`; срок сохраняется в версии и показывается сторонам, но пока не запускает таймер, автоматическое истечение или согласие. Правило ответа после дедлайна остаётся отдельным продуктовым решением.

## Typed contract

Канонические TypeScript-типы находятся в `src/domain/supplierSuborderWorkflow.ts`: `SupplierSuborderWorkflow`, `SupplierSuborderWorkflowLine`, `SupplierSuborderWorkflowReceipt`, `SupplierSuborderWorkflowCommand`, `SupplierSuborderWorkflowStatus` и `SupplierSuborderWorkflowErrorCode`. Числовая версия данных и исходные request snapshots остаются раздельными.

Receipt mutation RPC возвращает объект вида:

```json
{
  "supplier_suborder_id": "uuid",
  "status": "awaiting_buyer_decision",
  "workflow_version": 2,
  "current_terms_version": 2,
  "event_id": "uuid",
  "replayed": false
}
```

## Узкие RPC

Все публичные функции находятся в `public` как `SECURITY INVOKER`; проверки полномочий, блокировка и запись выполняются в worker-функциях `private`. Прямого клиентского доступа к private-таблицам нет.

- `list_supplier_suborders(p_supplier_organization_id)` — только собственные suborders для `owner`, `admin` или `order_operator`; не возвращает buyer organization, адрес или данные других веток.
- `list_buyer_supplier_suborder_workflows(p_buyer_organization_id, p_buyer_request_id)` — текущие версии только собственного buyer request; читать могут `owner`, `admin`, `buyer`, `viewer`.
- `accept_supplier_suborder(p_supplier_organization_id, p_supplier_suborder_id, p_expected_version, p_idempotency_key)`.
- `reject_supplier_suborder(p_supplier_organization_id, p_supplier_suborder_id, p_reason, p_expected_version, p_idempotency_key)`.
- `propose_supplier_suborder_version(p_supplier_organization_id, p_supplier_suborder_id, p_reason, p_response_deadline_at, p_lines, p_expected_version, p_idempotency_key)`, где `p_lines` — JSON-массив `{ buyer_request_line_id, quantity, price_amount }` для всех строк данной ветки.
- `accept_buyer_supplier_suborder_version(p_buyer_organization_id, p_supplier_suborder_id, p_terms_version, p_expected_version, p_idempotency_key)`.
- `reject_buyer_supplier_suborder_version(p_buyer_organization_id, p_supplier_suborder_id, p_terms_version, p_reason, p_expected_version, p_idempotency_key)`.

Всего в публичном контракте семь workflow RPC. Ответ `list_buyer_supplier_suborder_workflows` включает `created_at` и `updated_at` workflow (оба `timestamptz`); worker, публичная обёртка и сгенерированный TypeScript return type должны совпадать. `created_at` — время создания workflow, а не timestamp отдельного решения; историю решений читают из событий/версий.

Supplier actions доступны только членам supplier tenant с ролями `owner`, `admin`, `order_operator`. Buyer decision доступен только `owner`, `admin`, `buyer`; `viewer` может прочитать предложение, но не принять его. Запросы с чужим ID дают безопасный not-found. UI не является границей безопасности.

## Повторы, гонки и аудит

Каждое изменение блокирует workflow-строку `FOR UPDATE`, затем проверяет `expectedVersion`. Любое несовпадение версии возвращает SQLSTATE `40001`; проигравший конкурентный вызов не перезаписывает победителя. Ключ идемпотентности ограничен действующей организацией: одинаковые ключ и payload возвращают исходный receipt с `replayed: true`; повторное использование ключа для другого действия или payload даёт `P0001`.

Событие и receipt идемпотентности записываются в той же транзакции, что новый статус/версия и, при proposal, снимок условий. Ошибка любого шага откатывает все записи операции. События, версии условий, строки версий и receipts защищены от UPDATE/DELETE. Исходные buyer snapshots не изменяются. Workflow создаётся триггером при вставке supplier-suborder line в уже существующей транзакции создания запроса; миграция также инициализирует ранее созданные локальные ветки.

Ожидаемые SQLSTATE: `42501` — недостаточно прав; `P0002` — не найдено в доступной tenant-ветке; `23514` — некорректный ввод; `40001` — конфликт ожидаемой версии; `55000` — недопустимый переход; `P0001` — конфликт ключа идемпотентности. Клиент должен показывать только типизированный безопасный код, не SQL и не детали исключения.

## Не входит в этот контракт

Нет автоматических уведомлений, таймеров/истечения, запасов и резервов, превращения статуса родителя в принятый заказ, закупок, платежей, счетов, доставки, production или реальных supplier/buyer-данных. Inbox UI — отдельная зависимая работа; он использует существующие RPC и typed contract, не меняя backend state machine или схему БД.

## Технические источники

- [Supabase Database Functions](https://supabase.com/docs/guides/database/functions.md): предпочтителен `SECURITY INVOKER`; для вынужденного `SECURITY DEFINER` нужен пустой `search_path`, полностью квалифицированные имена и точечные `EXECUTE` grants.
- [Supabase Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security.md): grants определяют доступ к операции, а RLS — доступные строки; одного из этих уровней недостаточно.
- [Изменение Supabase Data API: новые таблицы больше не публикуются автоматически](https://supabase.com/changelog/45329-breaking-change-tables-not-exposed-to-data-and-graphql-api-automatically): внутренние workflow-таблицы остаются в непубличной схеме без клиентских grants; публичная поверхность ограничена явными RPC.
