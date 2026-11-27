# MOD-01 — локальная capability модератора

Реализован **технический** доверенный контур проверки поставщиков для прототипа. Он не является юридическим полномочием, верификацией личности, сертификацией качества или одобрением реального поставщика. Кто именно в продукте обладаеттакое полномочие的 — отдельное решение владельца (`blocker-decision-briefs.md`, MOD-01).

## Серверная модель

- `private.platform_moderators` — список user_id сбез прямого доступа; грантируется только доверенным SQL-процессом, не клиентским флагом, user_metadata, demo persona или query string. RLS включён, прямых grant нет.
- `private.is_platform_moderator()` — SECURITY DEFINER с `search_path = ''`, проверяет активную запись.
- `public.is_platform_moderator()` — узкий read-only RPC для UI.
- `public.list_pending_supplier_profiles()` — Только pending профили, только модератор.
- `public.decide_supplier_verification(p_organization_id, p_decision, p_reason)` — одна транзакция: обновление статуса + append-only событие в `private.platform_moderation_events`. Immutability защищена триггером.
- Самоподтверждение запрещено: если модератор состоит в проверяемой supplier-организации с ролью owner/admin/catalog_operator/order_operator, RPC возвращает `42501`.
- Ошибки: `42501` forbidden, `23514` invalid input, `55000` уже рассмотрен, `P0002` not found. Клиент показывает только безопасные типы.

## UI

`OperatorModerationPanel` рендерится во всех organization-контекстах, но сразу скрывается, если `is_platform_moderator` вернул false. Для модератора: список pending с причиной решения, кнопки «Одобрить/Отклонить», обязательная причина 1–1000 символов, безопасные состояния загрузки/ошибки/успеха. Копия прямо говорит, что это внутренний статус прототипа, а не юридическая верификация.

## Тесты

- pgTAP `supabase/tests/platform_moderation.test.sql`: 21 assertion — grants/RLS, аноним и аутентифицированный без роли, supplier self-approval, approve/reject, повторное решение, невалидный ввод, append-only история.
- 6 adapter-тестов и 3 компонентных теста (включая негативные роли и обязательную причину).

## Граница

Все доказательства — local/ephemeral CI на синтетических данных. Никаких реальных поставщиков, документов, уведомлений, hosted DB, production или коммерческих решений. generated `database.types.ts` обновлён один раз после стабилизации миграции.
