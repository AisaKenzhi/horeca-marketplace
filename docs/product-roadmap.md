# HoReCa Marketplace — единый roadmap до Product Ready

**Назначение:** единый рабочий план для владельца и всех агентов. Это roadmap, а не подтверждение коммерческой, юридической или production-готовности и не разрешение на внешние операции.

**Проверенная code-база:** integration feature branch `feat/horeca-unified-delivery-2026-11-24` @ `fa6578dc72b4642676aa4e4f568cf99235f887af`, merge PR #32. После docs-only merge PR #31 integration HEAD стал `6025e4dd895a203964954cfb0d2660ae1aa4edcf`; post-merge CI и ephemeral Supabase checks на этом SHA успешно завершились, поэтому integration gate был полностью зелёным на момент этой проверки. Перед каждой новой задачей remote HEAD всё равно требуется проверить заново.

**Целевой результат:** приватный продукт, проверенный в изолированной непроизводственной среде и подготовленный к ограниченному закрытому пилоту после решения владельца и прохождения бизнес-, юридических, безопасностных и операционных gates. Сам пилот и публичный запуск — отдельные решения; roadmap не разрешает их начинать.

Сводка по снятию блокеров и минимальные вопросы владельцу: [`blocker-decision-briefs.md`](blocker-decision-briefs.md). Варианты в нём не выбраны агентом.

## Актуальная сводка и важные ограничения

- **Модель пилота:** платформа выступает продавцом в пользовательском потоке; внутренние подзаказы распределяются по поставщикам. Это выбранная продуктовая схема, но **не** решение о конкретном юридическом операторе, seller of record, налогах, договорах или ответственности.
- **PR #29:** merged, merge SHA `83bae73021cc580a6d656691448db82c1e190b18`; base PR — `feat/product-ready-tenant-foundation-2026-11-23`, source head — `feat/horeca-unified-delivery-2026-11-24` @ `6e9144c4c67a7e19d27fe3f40e7c044eaff3420c`. На merge SHA все три проверенных CI checks успешны: lint/typecheck/unit/build, Chromium desktop/mobile E2E, ephemeral Supabase/pgTAP/PostgREST.
- **PR #30:** merged в integration feature branch с merge SHA `ef40c1bf5a0cc8af34dd29a1f66c53e7d61f7b97`; base PR был `feat/horeca-unified-delivery-2026-11-24` @ `6e9144c4c67a7e19d27fe3f40e7c044eaff3420c`, PR head — `cb3c57bf50baf9e045b01c01208af78ba6641865`. PR-head checks были зелёными. На merge SHA run [45516817340](https://github.com/AisaKenzhi/horeca-marketplace/actions/runs/45516817340) показал три падения в `BuyerProcurementListsPanel.test.tsx`: success-flow fixtures имели `price_observed_at`/`availability_observed_at = 2026-11-24T00:00:00.000Z` (старше 24-часового порога) и `price_valid_until = 2026-11-25T00:00:00.000Z` (истёк к CI в 00:17 UTC). Продуктовая блокировка была корректной; `Map.groupBy is not a function` в Vitest reporter на Node 20.19 — вторичная ошибка после assertion failures. На merge SHA PR #30 E2E и ephemeral Supabase прошли, build был пропущен. Отдельный **test-only PR #32** изменил только временные buyer test fixtures, был слит в integration с SHA `fa6578dc72b4642676aa4e4f568cf99235f887af`; на этом merge SHA post-merge [CI](https://github.com/AisaKenzhi/horeca-marketplace/actions/runs/45520660167) и [ephemeral Supabase](https://github.com/AisaKenzhi/horeca-marketplace/actions/runs/45520660132) успешно завершились. Это закрывает CI-BASE-01 и подтверждает полный требуемый integration gate; buyer UI и доменная логика не менялись.
- **PR #31 post-merge verification:** docs-only merge commit `6025e4dd895a203964954cfb0d2660ae1aa4edcf` стал integration HEAD. На нём успешно завершились [CI run 45522142097](https://github.com/AisaKenzhi/horeca-marketplace/actions/runs/45522142097) (format, lint, typecheck, unit/component, build, Chromium desktop/mobile E2E) и [ephemeral Supabase/pgTAP/PostgREST run 45522142029](https://github.com/AisaKenzhi/horeca-marketplace/actions/runs/45522142029). Значит, integration полностью зелёный на `6025e4d`; в CI остались только неблокирующие Node.js deprecation/Fast Refresh warnings.
- **Buyer proposal/current-terms UI:** владелец снял паузу 25 ноября 2026 года; BUY-TERMS-01 завершена PR #34 и слита в integration branch с merge SHA `a9bdd6e49a5773d17605e6a8c543521bffdc1ad0`. Required CI и ephemeral Supabase checks на результате слияния зелёные (run `45712212664` и `45712212621`).
- **`main` и production:** PR #29–#32 не направлялись в `main`; на момент проверки `main` был на `1980bcf2ef3aa97d9351697d01f2401547d36e17`. Production, hosted/live DB, deploy, реальные заказы, платежи и уведомления этим roadmap/task не затрагивались.
- **Handoff и PR #31:** [`handoff-unified-delivery.md`](handoff-unified-delivery.md) обновлён под текущие результаты. PR #31 merged только с `AGENTS.md`, этим roadmap и handoff в integration branch; 6/6 required checks прошли перед merge, post-merge checks на SHA `6025e4d` тоже green. Актуальные base/head и checks перед каждой следующей задачей всё равно перепроверять в GitHub.

### Правило статусов

- **DONE** — работа влита в текущую integration feature branch через PR, требуемые checks успешны на результате слияния, acceptance criteria выполнены. Для исторической базы PR #29 его собственный merge SHA и проверки подтверждены отдельно выше.
- **IN PROGRESS** — работа реально начата и есть текущий исполнитель/ветка; указываются только выполненные части и текущие проверки.
- **NEXT** — единственный следующий разрешённый пункт после проверки зависимостей и решений владельца. До начала он не должен иметь активных изменений.
- **BLOCKED** — работу нельзя начинать/завершать до указанного события, решения или устранения проверяемого blocker. Если блокировка связана с волей владельца, агент не снимает её сам.
- **NOT STARTED** — работа ещё не начата и пока не является следующим разрешённым пунктом.

Владелец 26 ноября 2026 года разрешил агенту выбирать задачи по очереди и отмечаться после каждой. BUY-UAT-01 завершена PR #36 (merge `9f6ca7249c4a109ea94395cdacd4dd77ec82f12e`). Клавиатурная/reflow часть A11Y-MANUAL-01 выполнена PR #38 (merge `3b26d65959ef0cbf3369b5799f8177148154b284`); оставшаяся screen-reader часть BLOCKED без оператора NVDA/JAWS/VoiceOver. Следующие по очереди REL-_/STAGE-_ требуют разрешённой непроизводственной среды и не повышаются без решения владельца.

Статус этапа — сводка его задач: он не становится DONE, пока не выполнены все обязательные задачи этапа и их gates.

## Обязательный порядок работы агентов

1. Перед любой задачей прочитать `AGENTS.md` и этот roadmap; затем свежо проверить remote `feat/horeca-unified-delivery-2026-11-24`, PR и required checks. Не полагаться на старые локальные checkout, SHA, handoff или отчёты.
2. Взять **только** задачу, помеченную `NEXT`, и лишь после проверки всех зависимостей, разрешений и бизнес-решений. Не выбирать `BLOCKED`/`NOT STARTED` и не возобновлять задачу, остановленную владельцем.
3. При начале поставить задаче `IN PROGRESS` в roadmap, указать агента/ветку/PR и исходный SHA. Обновлять прогресс, тесты, фактические результаты и blocker по мере работы; не выдавать предположение за результат.
4. Работать в отдельной worktree от свежего integration HEAD. Для каждого изменения создать отдельную feature branch и PR **в актуальную integration feature branch**. После review и зелёных required checks слить готовый PR сразу, не накапливать завершённые ветки. Перед push/merge заново сверить remote base/head; при расхождении остановиться и согласовать безопасное обновление.
5. `DONE` ставить только после merge в integration branch и зелёных required checks на результирующем commit. Не делать merge в `main`, deploy, подключение/миграции live DB, реальные заказы, платежи, расчёты, доставку или реальные уведомления без отдельного явного разрешения Айсы.
6. Не force-push, не переписывать чужие ветки/рабочие копии и не удалять пользовательские незакоммиченные файлы. Если проверка падает, зафиксировать точный SHA, check и следующий шаг; не объявлять задачу завершённой.

## Таблица прогресса

`Текущий SHA` — commit, к которому относится работа/проверенное состояние. Для задач без реализации указан только baseline; он не означает наличие коммита по задаче. Если локальная и удалённая ветки расходятся, актуален удалённый HEAD после свежей проверки.

| Task ID         | Статус      | Исполнитель / ветка / PR                                                                                             | Текущий SHA                                                                                                                                           | Что готово                                                                                                                           | Тесты / проверки                                                                                                                                                                                                   | Blocker / следующий шаг                                                                                                                |
| --------------- | ----------- | -------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| CI-BASE-01      | DONE        | PR #32; `fix/buyer-test-freshness-ci-2026-11-25` → integration                                                       | `fa6578dc72b4642676aa4e4f568cf99235f887af` (PR #32 merge; source `bce97984a336c004366ed131c2c8d4134059e306`)                                          | Только три buyer success-flow test fixtures переведены на свежие timestamps относительно времени теста                               | Targeted: 10/10; `npm run verify:full`: 309/309; `npm run e2e:ci`: 47 passed, 3 skipped; PR #32 post-merge runs 45520660167/45520660132 green; final integration checks 45522142097/45522142029 green on `6025e4d` | Нет blocker: CI gate подтверждён и на code-fix SHA `fa6578d`, и после docs merge на `6025e4d`; buyer UI/product logic не менялись      |
| TENANT-BASE-01  | DONE        | PR #29; `feat/horeca-unified-delivery-2026-11-24` → `feat/product-ready-tenant-foundation-2026-11-23`; PR #29        | `83bae73021cc580a6d656691448db82c1e190b18`                                                                                                            | Tenant/account foundation, roles, RLS, buyer locations и управляемые профили; дальнейшие privacy/moderation задачи выделены отдельно | 3 required CI checks на merge SHA green                                                                                                                                                                            | Следующий отдельный пункт — account deletion/retention policy после решения владельца                                                  |
| BUY-BASE-01     | DONE        | PR #29; см. merge PR #29                                                                                             | `83bae73021cc580a6d656691448db82c1e190b18`                                                                                                            | Атомарный buyer request, immutable snapshots строк и локации, frozen cart; request не называется принятым заказом                    | CI PR #29 green; E2E desktop/mobile; Supabase concurrency suite green                                                                                                                                              | Buyer acceptance of supplier-proposed current terms — отдельная задача BUY-TERMS-01                                                    |
| CAT-BASE-01     | DONE        | Базовая catalog/import implementation присутствует в проверенной feature base; PR #29 green baseline                 | `83bae73021cc580a6d656691448db82c1e190b18`                                                                                                            | Supplier offers и ограниченный CSV preview/apply с серверной повторной валидацией и идемпотентностью                                 | Unit/component suite и build PR #29 green                                                                                                                                                                          | Self-service onboarding, price/availability governance и операционная проверка — SUP-ONBOARD-01/CAT-OPS-01                             |
| SUP-WF-01       | DONE        | PR #29; backend workflow в integration source                                                                        | `83bae73021cc580a6d656691448db82c1e190b18`                                                                                                            | Private supplier suborders; 7 публичных узких RPC; immutable events/receipts; version/idempotency/audit                              | Supabase pgTAP/PostgREST и остальные required checks PR #29 green                                                                                                                                                  | Не является резервированием, подтверждённой закупкой, платежом или доставкой                                                           |
| SUP-INBOX-01    | DONE        | PR #30; `feat/supplier-suborder-inbox-ui-2026-11-25` → integration; post-merge regression fixed separately by PR #32 | `fa6578dc72b4642676aa4e4f568cf99235f887af` (PR #30 merge `ef40c1bf5a0cc8af34dd29a1f66c53e7d61f7b97`; head `cb3c57bf50baf9e045b01c01208af78ba6641865`) | Frontend-only supplier inbox работает поверх существующих RPC; без backend/state changes                                             | PR #30 source checks green; post-merge checks 45520660167/45520660132 green на `fa6578d`; повторная проверка CI/Supabase 45522142097/45522142029 green на `6025e4d`                                                | Inbox gate закрыт; дедлайны/молчание поставщика остаются отдельным blocker SUP-RESPONSE-01; не реконструировать скрытую audit history  |
| BUY-TERMS-01    | DONE        | PR #34; `coder-a/buy-terms-01-2026-11-25` → integration                                                              | `a9bdd6e49a5773d17605e6a8c543521bffdc1ad0` (merge PR #34; source `8dfea55`)                                                                           | Buyer видит текущую proposal и явно принимает/отклоняет точную `termsVersion` через существующие typed RPC; viewer read-only         | Локально: `verify:full` 320 tests, coverage 84.17/76.53/91.09/87.86, `e2e:ci` 47 passed/3 skipped, audit 0; PR #34 checks green; post-merge CI 45712212664 и Supabase 45712212621 green на `a9bdd6e`               | Блокеров нет. BUY-UAT-01 закрыта локальным PR #36 на синтетических персонах                                                            |
| SUP-ONBOARD-01  | BLOCKED     | Не назначен; branch/PR отсутствуют                                                                                   | Baseline `fa6578d`; task commit отсутствует                                                                                                           | Существует supplier profile/catalog foundation                                                                                       | Новые onboarding tests не запускались                                                                                                                                                                              | Нужны выбранные пилотный сегмент, документы допуска, контактные и коммерческие поля, владелец проверки                                 |
| CAT-OPS-01      | BLOCKED     | Не назначен; branch/PR отсутствуют                                                                                   | Baseline `fa6578d`; task commit отсутствует                                                                                                           | CSV preview/apply есть; полноценный supplier self-service и история цен/наличия не заявлены                                          | Новые тесты не запускались                                                                                                                                                                                         | Зависит от SUP-ONBOARD-01 и согласованных правил свежести, единиц, цен и доступности                                                   |
| MOD-01          | BLOCKED     | Не назначен; branch/PR отсутствуют                                                                                   | Baseline `fa6578d`; task commit отсутствует                                                                                                           | В доверенной DB роли platform moderator нет                                                                                          | Новые тесты не запускались                                                                                                                                                                                         | Нужны владелец полномочий, доверенная identity/role модель и threat review; поставщик не может сам одобрить себя                       |
| BUY-UAT-01      | DONE        | PR #36; `coder-a/buy-uat-01-2026-11-26` → integration                                                                | `9f6ca7249c4a109ea94395cdacd4dd77ec82f12e` (merge PR #36)                                                                                             | Локальный UAT на синтетических персонах: пустой каталог, stale/unknown, partial basket, version conflict, повтор submit              | `verify:full` 320 tests; `e2e:ci` 51 passed / 3 skipped; post-merge CI 45731018987 и Supabase 45731018945 green на `9f6ca72`                                                                                       | Внешних участников не было; ручной screen-reader остаётся в A11Y-MANUAL-01                                                             |
| SUP-RESPONSE-01 | DONE        | PR #43; `coder-a/sup-response-01-2026-11-26` → integration                                                           | `0080029` (merge PR #43)                                                                                                                              | Локальный обратимый default: срок ответа информационный, без таймера/авто-согласия; единая копия в supplier и buyer UI               | `verify:full` 322 tests; `e2e:ci` 55 passed / 3 skipped; post-merge CI 45791716251 и Supabase 45791716346 green на `0080029`                                                                                       | Реальная SLA-политика пилота (expiry, продление, timezone, молчание) остаётся открытым решением владельца                              |
| STOCK-01        | IN PROGRESS | Agent OpenCode; `coder-a/stock-01-2026-11-26`; PR в integration после проверок                                       | Baseline `fa6578d`; task commit отсутствует                                                                                                           | Supplier-reported availability — только наблюдение; числовой остаток/резерв не реализованы                                           | Нет inventory concurrency suite                                                                                                                                                                                    | Требуется выбрать модель: подтверждение поставщика, reserve TTL или иное; согласовать с поставщиками и юристом                         |
| ORDER-01        | BLOCKED     | Не назначен; branch/PR отсутствуют                                                                                   | Baseline `fa6578d`; task commit отсутствует                                                                                                           | Buyer request и supplier proposal/response разделены                                                                                 | Есть тесты только для текущего request/suborder workflow                                                                                                                                                           | Нужны статусы подтверждённой закупки, отмены/частичного исполнения, владельцы переходов и причины                                      |
| RECEIVE-01      | BLOCKED     | Не назначен; branch/PR отсутствуют                                                                                   | Baseline `fa6578d`; task commit отсутствует                                                                                                           | Демо-модель receiving не подтверждает production процесс                                                                             | Нет persistent account acceptance/dispute tests                                                                                                                                                                    | Зависит от ORDER-01, FUL-01, юридических сроков и процедуры претензий                                                                  |
| LEGAL-01        | BLOCKED     | Владелец/квалифицированный консультант не назначен; PR нет                                                           | Baseline `fa6578d`; документных утверждений нет                                                                                                       | Platform-as-seller выбран как поток пилота; юрлицо/роль не определены                                                                | Требуется письменный review и список применимых требований                                                                                                                                                         | Утвердить оператора, страну/юрисдикцию, договоры, seller of record, ответственность, consumer/B2B и product-specific требования        |
| FIN-01          | BLOCKED     | Не назначен; PR нет                                                                                                  | Baseline `fa6578d`; task commit отсутствует                                                                                                           | Нет утверждённых комиссии, маржи, налогов, счетов или settlement                                                                     | Требуются accounting/legal sign-off и тест-кейсы после решения                                                                                                                                                     | Утвердить pricing/fees, currency, tax/accounting docs, reconciliation, refunds, supplier payout и owner каждого расчёта                |
| PAY-01          | BLOCKED     | Не назначен; PR нет                                                                                                  | Baseline `fa6578d`; task commit отсутствует                                                                                                           | Checkout/payment/payout отсутствуют                                                                                                  | Payment sandbox tests не запускались                                                                                                                                                                               | Не выбирать провайдера или схему до LEGAL-01/FIN-01; любые реальные платежи запрещены без отдельного разрешения                        |
| FUL-01          | BLOCKED     | Не назначен; PR нет                                                                                                  | Baseline `fa6578d`; task commit отсутствует                                                                                                           | Доставка/тариф/покрытие не подтверждены                                                                                              | Нет logistics sandbox/операционных тестов                                                                                                                                                                          | Выбрать ответственного, зону, тариф, срок и правила категорий; подтвердить реальную способность исполнять                              |
| FUL-02          | BLOCKED     | Не назначен; PR нет                                                                                                  | Baseline `fa6578d`; task commit отсутствует                                                                                                           | Нет tracking/исключений/температурной цепи                                                                                           | Нет тестов                                                                                                                                                                                                         | Зависит от FUL-01, ORDER-01 и RECEIVE-01                                                                                               |
| OPS-NOTIFY-01   | BLOCKED     | Не назначен; PR нет                                                                                                  | Baseline `fa6578d`; task commit отсутствует                                                                                                           | Автоматические внешние сообщения отсутствуют                                                                                         | Нет доставки/повторов/consent tests                                                                                                                                                                                | Нужны утверждённые адресаты, каналы, шаблоны, согласия/основания, privacy, dedupe/retry и отдельное разрешение на реальные уведомления |
| OPS-SUPPORT-01  | BLOCKED     | Не назначен; PR нет                                                                                                  | Baseline `fa6578d`; task commit отсутствует                                                                                                           | Нет production operator console/runbook                                                                                              | Нет operator-role/RLS/audit tests                                                                                                                                                                                  | Зависит от MOD-01, SEC-PRIVACY-01 и утверждённых процедур споров                                                                       |
| SEC-BASE-01     | DONE        | Локальная tenant foundation; PR #29 green CI                                                                         | `83bae73021cc580a6d656691448db82c1e190b18`                                                                                                            | RLS/grants/tenant tests, no cross-tenant supplier workflow access, typed limited RPC; доказательства только local/ephemeral CI       | pgTAP, PostgREST, concurrency checks PR #29 green                                                                                                                                                                  | Не доказывает hosted security; перед deployment нужен независимый review и отдельный разрешённый staging scope                         |
| SEC-PRIVACY-01  | BLOCKED     | Не назначен; PR нет                                                                                                  | Baseline `fa6578d`; task commit отсутствует                                                                                                           | Нет утверждённых retention/deletion правил и hosted logging                                                                          | Требуются data inventory, threat/privacy review и негативные тесты                                                                                                                                                 | Нужны legal operator, цели/основания, сроки хранения, удаление/архивация, экспорт, redaction и breach process                          |
| LOC-01          | BLOCKED     | Не назначен; PR нет                                                                                                  | Baseline `fa6578d`; task commit отсутствует                                                                                                           | Русский default; `kk` сейчас алиас; supplier offer currency явная; KZT встречается в synthetic examples                              | Автоматизированной полной ru/kk и валютной терминологии проверки нет                                                                                                                                               | Выбрать город/языки и currency policy; не добавлять FX или считать KZT общей валютой без решения                                       |
| A11Y-AUTO-01    | DONE        | Automated axe + Chromium desktop/mobile E2E; inherited in integration                                                | `fa6578dc72b4642676aa4e4f568cf99235f887af`                                                                                                            | Automated axe gate и desktop/mobile Playwright покрытие в актуальной feature base                                                    | PR #29 E2E green; current integration CI run 45520660167 green после исправления test-fixture регрессии                                                                                                            | Это не заменяет ручную доступность; ручной screen-reader/keyboard/zoom pass остаётся отдельной задачей A11Y-MANUAL-01                  |
| A11Y-MANUAL-01  | BLOCKED     | PR #38; `coder-a/a11y-manual-01-2026-11-26` → integration                                                            | `3b26d65959ef0cbf3369b5799f8177148154b284` (merge PR #38)                                                                                             | Keyboard-only вход, выбор локации и submit; reflow 320px; исправлена потеря фокуса после ошибки входа                                | `verify:full` 320 tests; `e2e:ci` 55 passed / 3 skipped; post-merge CI 45733064404 и Supabase 45733064403 green на `3b26d65`                                                                                       | Screen reader не проверен: нет NVDA/JAWS/VoiceOver и оператора. Не заявлять полный accessibility sign-off                              |
| REL-OBS-01      | BLOCKED     | Не назначен; PR нет                                                                                                  | Baseline `fa6578d`; task commit отсутствует                                                                                                           | Production monitoring/alerting/tracing не подключены                                                                                 | Нет hosted metrics/alert tests                                                                                                                                                                                     | Нет разрешённой target architecture и nonprod среды; нужен owner SLO/alerts и redaction                                                |
| REL-BACKUP-01   | BLOCKED     | Не назначен; PR нет                                                                                                  | Baseline `fa6578d`; task commit отсутствует                                                                                                           | Backup/restore procedure и drill не подтверждены                                                                                     | Restore test отсутствует                                                                                                                                                                                           | Нет разрешённой disposable/nonprod среды и согласованных RPO/RTO                                                                       |
| REL-ABUSE-01    | BLOCKED     | Не назначен; PR нет                                                                                                  | Baseline `fa6578d`; task commit отсутствует                                                                                                           | CSV local limits есть; hosted Auth/API abuse limits не проверены                                                                     | Rate-limit/abuse security tests отсутствуют                                                                                                                                                                        | Нет hosted/nonprod архитектуры, security review и privacy limits                                                                       |
| STAGE-01        | BLOCKED     | Не назначен; PR нет                                                                                                  | Baseline `fa6578d`; task commit отсутствует                                                                                                           | Hosted/staging account не связан                                                                                                     | Deploy/hosted DB не запускались                                                                                                                                                                                    | Нужны все применимые upstream gates и отдельное разрешение на изолированный nonprod setup                                              |
| STAGE-02        | BLOCKED     | Не назначен; PR нет                                                                                                  | Baseline `fa6578d`; task commit отсутствует                                                                                                           | Непроизводственный release/rollback rehearsal не выполнялся                                                                          | Нет migration/rollback/restore rehearsal                                                                                                                                                                           | Зависит от STAGE-01 и готовых security/reliability runbooks                                                                            |
| PILOT-01        | BLOCKED     | Владелец; решения/артефакты не утверждены                                                                            | Baseline `fa6578d`; task commit отсутствует                                                                                                           | Есть список открытых вопросов; город, сегмент и метрики не выбраны                                                                   | Discovery evidence отсутствует                                                                                                                                                                                     | Утвердить город, аудиторию, категории, лимиты, метрики/знаменатели, окно оценки и stop criteria                                        |
| PILOT-02        | BLOCKED     | Не назначен; нет разрешения на запуск                                                                                | Baseline `fa6578d`; task commit отсутствует                                                                                                           | Пилотный gate не закрыт                                                                                                              | Нет end-to-end controlled nonprod/pilot evidence                                                                                                                                                                   | Нужны legal/accounting, supplier/buyer consent, support, security, backups, green CI и отдельное разрешение владельца                  |
| PILOT-EXEC-01   | BLOCKED     | Не назначен; внешняя работа не разрешена                                                                             | Baseline `fa6578d`; task commit отсутствует                                                                                                           | Реальный пилот не объявлялся                                                                                                         | Реальные заказы/платежи/сообщения не выполнялись                                                                                                                                                                   | Нет PILOT-02 GO и явного owner approval на участников, scope и лимиты                                                                  |
| LAUNCH-01       | BLOCKED     | Владелец; нет launch approval                                                                                        | Baseline `fa6578d`; task commit отсутствует                                                                                                           | Публичного запуска нет                                                                                                               | Production checks/deploy отсутствуют                                                                                                                                                                               | Нет pilot criteria, GO/No-Go, deploy approval и проверенной экономики                                                                  |

## Этапы и конкретные задачи

Этапы следуют зависимостям, а не календарю. Параллельно разрешены только безопасные локальные спецификации и тесты, не меняющие внешнюю систему. Решения владельца, юридическая экспертиза и production setup не заменяются кодом.

### Этап 0 — Стабилизировать актуальную integration-базу

**Статус этапа: DONE** — PR #32 слит в integration; требуемые post-merge CI и ephemeral Supabase checks успешны на `fa6578dc72b4642676aa4e4f568cf99235f887af`, а после docs-only PR #31 оба gate повторно прошли на `6025e4dd895a203964954cfb0d2660ae1aa4edcf`.

#### CI-BASE-01 — устранить post-merge CI failure

**Статус: DONE.**

- **Цель и границы:** исправить только время в трёх success-flow фикстурах `src/features/account/BuyerProcurementListsPanel.test.tsx`: использовать timestamps относительно времени теста, не меняя корректные stale/expiry проверки и продуктовую блокировку. Ошибка Vitest `Map.groupBy` на Node 20.19 была вторичной ошибкой репортера. Buyer UI/доменная логика и buyer proposal feature не менялись.
- **Предусловия:** remote HEAD, PR #30 checks/logs и worktrees были перепроверены; отдельная ветка `fix/buyer-test-freshness-ci-2026-11-25` создана от integration `ef40c1bf5a0cc8af34dd29a1f66c53e7d61f7b97`; PR #32 был test-only и отдельно от docs-only PR #31.
- **Acceptance / DoD:** success-flow tests не зависят от календарной даты; regression tests сохраняют stale/expiry проверки; targeted suite и полный применимый CI прошли; PR #32 отдельно слит в integration; post-merge required CI и ephemeral Supabase checks зелёные на `fa6578dc72b4642676aa4e4f568cf99235f887af`.
- **Тесты и артефакты:** targeted `BuyerProcurementListsPanel` — 10 passed; `npm run verify:full` — 309 passed, format/typecheck/coverage/build green (два прежних Fast Refresh warnings); `npm run e2e:ci` — 47 passed, 3 skipped. Post-merge проверки успешны на code-fix SHA: [CI 45520660167](https://github.com/AisaKenzhi/horeca-marketplace/actions/runs/45520660167) и [Supabase 45520660132](https://github.com/AisaKenzhi/horeca-marketplace/actions/runs/45520660132); повторно на integration HEAD после PR #31: [CI 45522142097](https://github.com/AisaKenzhi/horeca-marketplace/actions/runs/45522142097) и [Supabase 45522142029](https://github.com/AisaKenzhi/horeca-marketplace/actions/runs/45522142029). Исходный failure: [run 45516817340](https://github.com/AisaKenzhi/horeca-marketplace/actions/runs/45516817340).
- **Blocker:** отсутствует для этой задачи; Stage 0 закрыт. Другую задачу не назначать `NEXT` без решения владельца.

### Этап 1 — Tenant/account foundation и доверенные полномочия

**Статус этапа: IN PROGRESS** — базовый слой есть и проверен; deletion/retention и доверенная operator/moderator authority не закрыты.

#### TENANT-BASE-01 — существующая tenant/account основа

**Статус: DONE для зафиксированного PR #29 scope.**

- **Цель и границы:** сохранить существующий Auth/workspace, tenant roles, locations, supplier profile и RLS/grants/RPC boundaries; не считать UI проверкой доступа.
- **Предусловия:** свежие миграции и реальный тестовый tenant создаются только в разрешённой local/ephemeral DB.
- **Acceptance / DoD:** buyer/supplier object ownership выводится сервером; роли и права проверяются для каждого write; чужой object ID не раскрывает данные; используемая локация не удаляется; snapshots заказа не зависят от последующей правки адреса.
- **Тесты и артефакты:** tenant/role pgTAP, component/E2E edit/delete scenarios, CI PR #29 merge `83bae...`; список применённых migrations/RPC и локальных доказательств.

#### ACC-DELETE-01 — account/org deletion, export и retention

**Статус: BLOCKED; tracked в SEC-PRIVACY-01.**

- **Цель и границы:** определить удаление аккаунта/организации, перенос владения/архивацию, экспорт, retention для заявок и audit. Не выбрать срок хранения за владельца.
- **Предусловия:** назначены юридический оператор и владелец записей; утверждены правовые основания/сроки и последствия для immutable snapshots, invitations и finance records.
- **Acceptance / DoD:** утверждённая data inventory и policy описывает, что удаляется, анонимизируется или хранится, кем и в какой срок; интерфейс не обещает несуществующее удаление; реализация least-privilege, транзакционная и восстанавливаемая.
- **Тесты и артефакты:** legal/privacy sign-off, matrix данных и ролей, pgTAP для owner/non-owner/retention/foreign tenant, E2E и deletion audit.
- **Blocker:** решения владельца и профильная экспертиза.

#### MOD-01 — доверенная platform-moderator authority

**Статус: BLOCKED.**

- **Цель и границы:** безопасно определить, кто может проверять поставщиков, каталог и проблемные заказы; текущего доверенного moderator DB role нет. Не давать supplier самоподтверждение и не реализовывать moderation через скрытую кнопку.
- **Предусловия:** назначены оператор платформы, полномочия, identity source, separation-of-duties и break-glass owner.
- **Acceptance / DoD:** привилегия назначается только доверенным серверным процессом; deny-by-default grants/RLS; все действия с причиной append-only audit; отзыв доступа и расследование проверены.
- **Тесты и артефакты:** threat model, role/tenant negative pgTAP, audit tests, операторский runbook и утверждение владельца.
- **Blocker:** trusted authority и legal/operator decision отсутствуют.

### Этап 2 — Onboarding поставщика, каталог, цены и доступность

**Статус этапа: IN PROGRESS** — каталог и ограниченный CSV import есть; полный self-service и процесс верификации не сделаны.

#### CAT-BASE-01 — существующий каталог и CSV import

**Статус: DONE для текущего локального scope.**

- **Цель и границы:** сохранить offer snapshots и ограниченный импорт каталога; не добавлять XLSX/ERP/1C или live sync без подтверждённой потребности.
- **Предусловия:** синтетические fixtures и лимиты файла/строк; никаких реальных прайсов в тестах.
- **Acceptance / DoD:** preview показывает все ошибки; сервер повторно валидирует; apply атомарен/идемпотентен; повтор не создаёт дубликаты; formula-like cells не исполняются; цены/наличие имеют отдельные timestamps.
- **Тесты и артефакты:** unit/component tests для bounds, malformed rows, retry/dedup, stale prices, CSV safety; merge/check evidence PR #29.

#### SUP-ONBOARD-01 — supplier onboarding и коммерческий профиль

**Статус: BLOCKED.**

- **Цель и границы:** определить onboarding шаги для профиля, контактных данных, категорий, delivery zones, условий, документов допуска и обновления каталога. Не собирать реальные данные или документы в прототипе без отдельного разрешения.
- **Предусловия:** PILOT-01, legal operator, список обязательных документов и процесс доверенной проверки.
- **Acceptance / DoD:** supplier видит неполные/ожидающие поля; статус pending не называется approved; неподтверждённые документы и условия не публикуются; повторное прохождение onboarding не создаёт дубль; правила и responsible reviewer задокументированы.
- **Тесты и артефакты:** локальные synthetic onboarding scenarios, role/RLS tests, error/retry E2E, approved field list и operator checklist.
- **Blocker:** сегмент, юрисдикция и процесс допуска не определены.

#### CAT-OPS-01 — offer CRUD, versioned price/availability и свежесть

**Статус: NOT STARTED.**

- **Цель и границы:** дать разрешённым supplier roles управление offer lifecycle: draft/publish/unpublish, упаковка и единицы, MOQ/step, цена, валюта, доступность и история наблюдений.
- **Предусловия:** SUP-ONBOARD-01; владелец данных цены/остатка; freshness thresholds и правила изменения условий утверждены.
- **Acceptance / DoD:** каждая цена/доступность имеет источник и `observed_at`; stale/unknown не выглядит актуальным; изменение условий versioned/audited; импорт и UI не меняют чужого supplier; покупатель видит упаковку/MOQ/валюту и точную причину блокировки.
- **Тесты и артефакты:** unit, integration, RLS/pgTAP и E2E для stale/unknown/changed versions, роли, atomic bulk update, dedup и catalogue freshness dashboard.
- **Зависимости:** бизнес-правила свежести, единиц и ассортиментных категорий ещё не согласованы.

### Этап 3 — Buyer request и явное принятие текущих условий поставщика

**Статус этапа: DONE** — BUY-BASE-01, BUY-TERMS-01 и BUY-UAT-01 закрыты локальными/CI проверками; BUY-UAT не был исследованием с реальными покупателями.

#### BUY-BASE-01 — buyer draft и request submission

**Статус: DONE для текущего request-only scope.**

- **Цель и границы:** сохранять черновые списки/корзину и отправлять атомарный procurement request платформе как продавцу; это не accepted purchase/order.
- **Предусловия:** действующий tenant membership, выбранная buyer location; серверная повторная проверка offer freshness, approval, price expiry, MOQ/step.
- **Acceptance / DoD:** повторная отправка идемпотентна; snapshots строк и location неизменяемы; cart freeze атомарен; частичный request не сохраняется; покупателю показано `submitted`, а не `accepted/reserved/delivered`.
- **Тесты и артефакты:** local Supabase/pgTAP, request concurrency smoke, component/E2E reload/mobile и CI PR #29 merge green.

#### BUY-TERMS-01 — buyer proposal/current-terms UI

**Статус: DONE через PR #34** (merge `a9bdd6e49a5773d17605e6a8c543521bffdc1ad0`). Пауза снята владельцем 25.11.2026; работа выполнена в отдельной worktree и ветке `coder-a/buy-terms-01-2026-11-25`.

- **Цель и границы:** после отдельного разрешения дать покупателю увидеть proposal поставщика и принять/отклонить **ровно указанную** версию `termsVersion` через существующие typed RPC. Это не создание новой backend state machine и не реальный заказ.
- **Предусловия:** owner re-opens task; CI-BASE-01 и SUP-INBOX-01 закрыты; `supplier-suborder-workflow.md` перепроверен на свежей integration branch.
- **Acceptance / DoD:** текущая версия, строки, цена, количество, причина и срок понятны; accept/reject доступен только buyer owner/admin/buyer; viewer read-only; молчание не означает согласия; stale `workflowVersion`/`termsVersion` безопасно обновляется и не принимает старое предложение; идентичный retry сохраняет idempotency key; UI не заявляет доступ к полной audit history, если API её не выдаёт.
- **Тесты и артефакты:** 6 adapter tests и 5 component tests (негативные роли, точный RPC payload, stale `termsVersion`, причина отклонения, идемпотентность); `npm run verify:full` 320 tests; `npm run e2e:ci` 47 passed / 3 skipped; PR #34 checks и post-merge run 45712212664 / 45712212621 green на merge SHA `a9bdd6e`. Ручной keyboard/screen-reader проход не выполнялся — остаётся в A11Y-MANUAL-01.
- **Blocker:** отсутствует. DONE зафиксирован после merge в integration с зелёными required checks на `a9bdd6e`.

#### BUY-UAT-01 — buyer usability и сценарии блокировок

**Статус: DONE через PR #36** (merge `9f6ca7249c4a109ea94395cdacd4dd77ec82f12e`). Выполнено на синтетических персонах и nonprod fixture, без внешних контактов.

- **Цель и границы:** проверить пустой каталог, stale/unknown terms, partial basket, конфликт версии и повторное отправление на выбранном пилотном сегменте. Не обращаться к внешним участникам без отдельного поручения.
- **Предусловия:** BUY-TERMS-01 разрешён и реализован; выбранные пользовательские personas и nonprod fixtures.
- **Acceptance / DoD:** пользователь может объяснить, что отправлено, что ещё требует решения и почему supplier branch заблокирована; нет ложного обещания оплаты/резерва/доставки.
- **Тесты и артефакты:** `docs/buyer-uat-checklist.md` с матрицей сценариев; 2 новых E2E-сценария (пустой каталог, изменённая версия оффера); `e2e:ci` 51 passed / 3 skipped; post-merge run 45731018987 / 45731018945 green на `9f6ca72`.

### Этап 4 — Supplier response, inbox и согласование suborders

**Статус этапа: BLOCKED** — workflow backend и supplier inbox завершены; сам этап не закрыт из-за нерешённых правил deadline, молчания и последствий для suborders.

#### SUP-WF-01 — versioned supplier-suborder backend

**Статус: DONE для workflow contract PR #29.**

- **Цель и границы:** отдельные supplier branches с typed read/mutation RPC, `expectedVersion`, idempotency, append-only events/receipts и immutable source snapshots. Workflow не принимает buyer request, не резервирует stock и не выполняет side effects.
- **Предусловия:** только собственный tenant; private tables недоступны напрямую; public surface — явные RPC.
- **Acceptance / DoD:** supplier видит только свои ветви; buyer видит только свои; role check server-side; stale version конфликтует; одинаковый ключ+payload безопасно replay; новый payload под тем же ключом отклоняется; каждый write/event/receipt атомарен.
- **Тесты и артефакты:** 7 pgTAP suites, семь публичных workflow RPC, SQL/TypeScript return contract включая timestamps, concurrent accept/reject и required CI PR #29 green.

#### SUP-INBOX-01 — supplier inbox UI

**Статус: DONE после merge PR #30 и восстановления полного integration CI отдельным test-only PR #32.**

- **Цель и границы:** frontend-only inbox на существующих RPC. Не добавлять backend workflow, DB, moderation, notifications, reservations, payments, delivery или audit endpoint.
- **Предусловия:** CI-BASE-01 green; проверены актуальные integration branch и компонентная модель доступа.
- **Acceptance / DoD:** только собственные suborders; корректные loading/error/empty; accept/reject/propose соответствует текущему contract; stale conflict безопасно обновляется; повтор клика не дублирует действие; UI говорит «текущее состояние по API», не выдумывает полную историю событий.
- **Тесты и артефакты:** source PR #30 checks прошли; после PR #32 required post-merge CI run 45520660167 и ephemeral Supabase run 45520660132 зелёные на integration SHA `fa6578dc72b4642676aa4e4f568cf99235f887af`; текущая UI не заявляет доступ к полной private audit history.

#### SUP-RESPONSE-01 — сроки, молчание и действие после deadline

**Статус: DONE через PR #43** (merge `0080029`) в части локального обратимого default: срок информационный, без таймера и авто-согласия. Реальная SLA-политика пилота (expiry, продление, timezone, молчание) остаётся открытым решением владельца и не выдана за принятую.

- **Цель и границы:** определить, что значит `responseDeadlineAt`: reminder only, блокировка, истечение или иной outcome; сейчас запись срока не запускает timer и не создаёт auto-accept.
- **Предусловия:** поставщик/платформа/покупатель и юрист утверждают SLA, timezone, выходные, продление, отмену и последствия без ответа.
- **Acceptance / DoD:** одна однозначная state table; ни молчание, ни просрочка не меняют условия без явного действия; audit содержит причину/actor; UI показывает точный срок и зону времени.
- **Тесты и артефакты:** approved workflow spec, boundary/timezone/idempotency tests, notification plan (без отправки реальных сообщений).

### Этап 5 — Order/stock lifecycle, отмены и приёмка

**Статус этапа: BLOCKED** — нет подтверждённой модели запаса, договорной модели заказа, delivery и возвратов.

#### STOCK-01 — источник наличия и резервирование

**Статус: IN PROGRESS.** Владелец разрешил работать по BLOCKED без вопросов 26.11.2026; ветка `coder-a/stock-01-2026-11-26`, source `8a3c7e5`. Выбран обратимый локальный default: availability — наблюдение поставщика без количественного остатка, резерва и гарантии покупки.

- **Цель и границы:** выбрать, является ли availability supplier observation, подтверждаемым наличием или reservable stock; не выдавать `in_stock` за физический остаток.
- **Предусловия:** письменное подтверждение поставщика, коммерческая и юридическая модель, supplier update cadence.
- **Acceptance / DoD:** определены источник/частота/срок свежести, reserve ownership, TTL, capacity, release, oversell handling, partial acceptance и compensation; наличие в UI соответствует доказанному уровню.
- **Тесты и артефакты:** signed decision/spec, race/oversell/expiry/rollback tests на synthetic/local DB; никаких live reservations.

#### ORDER-01 — подтверждённый заказ, частичное исполнение и отмена

**Статус: BLOCKED.**

- **Цель и границы:** разделить request, seller acceptance, confirmed order, supplier branch, cancellation, fulfillment и payment states; каждый supplier suborder остаётся независимым.
- **Предусловия:** LEGAL-01, SUP-RESPONSE-01, STOCK-01 и FUL-01 утверждены.
- **Acceptance / DoD:** для перехода определены actor, source state, target state, полномочия, reason, idempotency, `expectedVersion`, audit, timeout и восстановление; partial cancel/accept не скрывает соседние ветки.
- **Тесты и артефакты:** state transition matrix, SQL/TypeScript contract, property/concurrency tests, negative role/tenant pgTAP, API/UI contract.

#### RECEIVE-01 — фактическая приёмка и претензии

**Статус: NOT STARTED.**

- **Цель и границы:** фиксировать принятую/недостающую/повреждённую/несоответствующую/просроченную поставку и обращение в поддержку; не обещать возврат до его определения.
- **Предусловия:** ORDER-01, FUL-01, юридические сроки, доказательства приёмки и процедура dispute.
- **Acceptance / DoD:** role/authority, timestamps, quantities, evidence, reason codes, partial receipt и appeal/reopen описаны; корректировки append-only.
- **Тесты и артефакты:** state matrix, pgTAP role/audit/idempotency cases, E2E partial receipt, synthetic evidence handling.

### Этап 6 — Юридическая, коммерческая и accounting модель

**Статус этапа: BLOCKED.** Техническая конфигурация `platform-as-seller` не определяет юридические обязанности.

#### LEGAL-01 — оператор, договоры и применимые требования

**Статус: BLOCKED.**

- **Цель и границы:** определить юридического оператора, seller of record, договорную модель buyer/supplier, товарную ответственность, претензии, возвраты, данные и рынок.
- **Предусловия:** владелец выбирает страну/город и профильного юридического консультанта; никаких юридических утверждений разработчиками на основе кода.
- **Acceptance / DoD:** подписанное/одобренное owner summary перечисляет юрлицо/роль, стороны и документы, ответственность, правила claims/refunds, privacy/retention и обязательные disclaimers; все открытые риски имеют владельца.
- **Тесты и артефакты:** legal review evidence и прослеживаемая карта требований → UI/API/data; это review gate, а не unit test.
- **Blocker:** юридический оператор и применимые решения не выбраны.

#### FIN-01 — цена, комиссия, налоги, документы и расчёты

**Статус: BLOCKED.**

- **Цель и границы:** согласовать buyer price, supplier settlement, fee/margin, currency, tax treatment, invoices/receipts, refunds, disputes, reconciliation и accounting owner. Не выбирать проценты и налоги за владельца.
- **Предусловия:** LEGAL-01 и профильный accountant; подтверждённые supplier terms и товарные категории.
- **Acceptance / DoD:** документированная formula/rounding в minor units, ledger events, invoice/tax responsibility, payout timing, partial/refund/dispute accounting, reconciliation evidence; суммы в UI/API совпадают по всей цепочке.
- **Тесты и артефакты:** signed commercial/accounting spec, decimal/rounding/property tests, ledger reconciliation fixtures, sandbox-only scenarios после отдельного одобрения.

#### PAY-01 — платежи и settlement провайдера

**Статус: BLOCKED.**

- **Цель и границы:** проектировать payment state machine и интеграцию только после выбора законной модели seller/payment flow. Сейчас checkout, card handling, escrow, split settlement и payout отсутствуют.
- **Предусловия:** LEGAL-01 и FIN-01, провайдер и country/currency coverage одобрены; sandbox разрешён отдельно.
- **Acceptance / DoD:** success/failure/pending/replay/cancel/refund/chargeback/reconciliation и webhook signatures обработаны идемпотентно; secrets не попадают в client; суммы сверяются с ledger; ни один UI status не означает оплату без провайдера.
- **Тесты и артефакты:** provider sandbox test matrix, webhook replay tests, reconciliation report, security review; **никаких реальных платежей** без отдельного разрешения.

### Этап 7 — Fulfillment и доставка

**Статус этапа: BLOCKED** — ответственность, покрытие и тарифы не выбраны.

#### FUL-01 — delivery responsibility, zones и tariffs

**Статус: BLOCKED.**

- **Цель и границы:** выбрать supplier/platform/carrier/mixed fulfillment, зоны, тарифы, минимумы, сроки, доплаты, объединение и условия категорий.
- **Предусловия:** пилотный город/категории, LEGAL-01, подтверждённые процессы поставщика/перевозчика.
- **Acceptance / DoD:** до подтверждённой покупки участники видят ответственного, сумму/метод расчёта и покрытие; неизвестная зона/стоимость блокирует обещание; ручной process допустим для пилота, если это явно заявлено.
- **Тесты и артефакты:** approved delivery matrix, zone/fee edge-case tests, sandbox/manual rehearsal и escalation runbook.

#### FUL-02 — исполнение, tracking и исключения

**Статус: NOT STARTED.**

- **Цель и границы:** моделировать pickup, handoff, in-transit, delivered, delay, partial delivery, failed delivery и категории с температурой/сроком годности только если они выбраны.
- **Предусловия:** FUL-01, ORDER-01, RECEIVE-01.
- **Acceptance / DoD:** отдельные supplier branches, каждый переход доказуем и аудируем; delivery не равна payment или buyer acceptance; расхождение маршрутизируется в поддержку.
- **Тесты и артефакты:** status transition tests, idempotent event replay, partial delivery/temperature evidence synthetic tests, operational rehearsal.

### Этап 8 — Trusted operations, поддержка и уведомления

**Статус этапа: BLOCKED** — нет trusted moderator authority, approved comms policy и operating model.

#### OPS-SUPPORT-01 — operator/support tooling и ручные корректировки

**Статус: NOT STARTED.**

- **Цель и границы:** дать support ограниченный просмотр и эскалации, а разрешённые корректировки проводить только как компенсирующее событие с причиной.
- **Предусловия:** MOD-01, SEC-PRIVACY-01 и dispute procedures утверждены.
- **Acceptance / DoD:** tenant/role isolation, least privilege, break-glass, append-only audit и reviewable reason; support не может редактировать immutable history или видеть лишние PII.
- **Тесты и артефакты:** operator role pgTAP, audit/PII leak tests, support playbook и escalation SLA.

#### OPS-NOTIFY-01 — уведомления поставщику/покупателю

**Статус: BLOCKED.**

- **Цель и границы:** специфицировать и только после approval реализовать уведомления об invitation, supplier response, terms change, delay и issue. Сейчас email/SMS/push/WhatsApp/Telegram integrations отсутствуют.
- **Предусловия:** legal/privacy basis, channels, recipient consent/expectations, templates, address verification, retry/retention rules и отдельное разрешение для реальной отправки.
- **Acceptance / DoD:** правильный адресат в правильном tenant; dedupe/idempotency/outbox; retry/backoff и dead-letter visibility; шаблоны не раскрывают чужие данные; mute/unsubscribe и delivery logs описаны.
- **Тесты и артефакты:** local fake provider contract tests, abuse/recipient isolation, retry/replay tests; real delivery только после отдельного owner approval.

### Этап 9 — Сквозные gates: security, privacy, localization, accessibility и reliability

**Статус этапа: IN PROGRESS** — local tenant isolation, automated gate и клавиатурный/reflow pass есть; screen reader, hosted и операционные доказательства отсутствуют.

#### SEC-BASE-01 — local tenant isolation и безопасные workflow boundaries

**Статус: DONE для проверенной local/ephemeral поверхности.**

- **Цель и границы:** сохранять RLS/grants/object checks и private workflow tables; demo persona не является Auth.
- **Acceptance / DoD:** чужие buyer/supplier IDs, роли и tenant не читают/меняют данные; grants deny-by-default; UI не выступает единственной защитой; ошибки безопасны.
- **Тесты и артефакты:** локальный pgTAP/PostgREST, concurrency, role-negative tests; PR #29 merge checks green. Это не доказывает hosted security.

#### SEC-PRIVACY-01 — data inventory, retention, deletion и logging

**Статус: BLOCKED.**

- **Цель и границы:** документировать личные, коммерческие, location, audit и financial fields; retention/deletion/export; redaction и incident handling.
- **Предусловия:** LEGAL-01 и ACC-DELETE-01.
- **Acceptance / DoD:** data-flow inventory с владельцем/основанием/сроком; минимизация и redaction; secrets/PII/SQL не попадают в user-facing errors/logs; data subject workflow определён и проверен.
- **Тесты и артефакты:** privacy review, synthetic log-leak tests, retention/deletion pgTAP/E2E, incident and breach runbook.

#### LOC-01 — языки, локаль и валюта

**Статус: BLOCKED.**

- **Цель и границы:** выбрать языки интерфейса и терминологию пилота; зафиксировать currency per offer/order, locale formatting, timezone; не делать FX без бизнес-решения.
- **Предусловия:** PILOT-01, supplier currency policy и legal/accounting review.
- **Acceptance / DoD:** ru/kk (если выбраны) полностью покрыты, без `kk` alias/непереведённых account strings; supplier currency видна и сохраняется в immutable terms; rounding/format consistent; invalid/unavailable currency блокируется.
- **Тесты и артефакты:** locale snapshot tests, plural/date/timezone/currency tests, native-speaker terminology review и language QA checklist.

#### A11Y-AUTO-01 — автоматизированный mobile/accessibility gate

**Статус: DONE для имеющегося автоматического покрытия.**

- **Цель и границы:** сохранить Chromium desktop/mobile E2E и automated axe WCAG 2.1 A/AA gate; не называть его полным accessibility sign-off.
- **Acceptance / DoD:** UI journeys в изменённых ветках проходят mobile viewport и automated accessibility checks.
- **Тесты и артефакты:** PR #29 E2E green; текущий integration CI run 45520660167 green, включая Chromium desktop/mobile E2E и automated axe gate; это не заменяет ручную accessibility проверку.

#### A11Y-MANUAL-01 — ручная клавиатура, screen reader и zoom

**Статус: BLOCKED (частично выполнено через PR #38).** Клавиатура, фокус, error announcement и reflow проверены на локальном synthetic build, Chromium desktop/mobile, merge `3b26d65`. Оставшаяся screen-reader часть требует оператора и инструмента и не выполнена.

- **Цель и границы:** проверить всех критических buyer/supplier/ops workflows с keyboard-only, screen reader, focus order, zoom/reflow и error announcement.
- **Предусловия:** стабильный candidate build и выбор тестового устройства/браузера.
- **Acceptance / DoD:** нет блокирующих keyboard traps, контекст/labels/statuses читаемы, zoom не скрывает primary actions; найденные дефекты имеют issue/PR; manual sign-off приложен.
- **Тесты и артефакты:** `docs/a11y-manual-checklist.md`, 2 E2E-сценария (keyboard-only sign-in; keyboard select/submit/reflow), `e2e:ci` 55 passed / 3 skipped, post-merge run 45733064404 / 45733064403 green на `3b26d65`. Screen reader и браузерный zoom не проверялись.

#### REL-OBS-01 — monitoring, health, errors и incident response

**Статус: NOT STARTED.**

- **Цель и границы:** определить health checks, error/latency/conflict metrics, correlation IDs, redaction, alerts, owner/on-call и response path для разрешённой непроизводственной среды.
- **Предусловия:** разрешённая target architecture и SEC-PRIVACY-01.
- **Acceptance / DoD:** alert test доставляется владельцу тестового канала; dashboards различают auth/data/provider failures; PII/secrets не логируются; runbook описывает triage, mitigation и escalation.
- **Тесты и артефакты:** fault-injection in nonprod, alert routing test, dashboard screenshots и incident runbook.

#### REL-BACKUP-01 — backups, restore и recovery runbook

**Статус: NOT STARTED.**

- **Цель и границы:** определить backup retention/access, RPO/RTO и безопасный восстановительный процесс; ничего не подключать к live DB.
- **Предусловия:** architecture, data retention policy и разрешённая disposable/nonprod environment.
- **Acceptance / DoD:** успешный restore drill, проверка целостности migrations/tenants, секретов и access controls; время и потери укладываются в утверждённые RPO/RTO; procedure пригодна для оператора.
- **Тесты и артефакты:** nonprod backup/restore evidence, checksum/integrity checks, runbook и owner approval.

#### REL-ABUSE-01 — abuse controls и ограничения

**Статус: NOT STARTED.**

- **Цель и границы:** проверить signup/login/recovery, каталожный import и request abuse, rate limits, file bounds и повторные попытки.
- **Предусловия:** выбранная hosted/nonprod архитектура, security review и privacy limits.
- **Acceptance / DoD:** ограничения наблюдаемы и не блокируют нормальные сценарии; brute-force/replay/quota tests; реакция на flood и suspicious supplier account документирована.
- **Тесты и артефакты:** nonprod load/abuse tests, safe rate-limit config, alert and remediation runbook.

### Этап 10 — Product Ready в изолированной непроизводственной среде

**Статус этапа: BLOCKED** — все upstream бизнес-решения и permissions, reliability и integration CI должны быть закрыты.

#### STAGE-01 — отдельная dev/staging architecture и secrets

**Статус: BLOCKED до явного разрешения на создание/подключение среды.**

- **Цель и границы:** спроектировать отдельные local/dev/staging/prod projects, домены, access, secrets rotation и ownership; prod не подключать.
- **Предусловия:** согласованные архитектура, vendor, privacy/legal и owner approval на конкретный nonprod scope.
- **Acceptance / DoD:** environment separation проверена; service-role keys только на серверной стороне; least privilege, separate data, backups, deployment identity и rollback определены; никакого shared live key.
- **Тесты и артефакты:** architecture decision, secret/access review, nonprod smoke, config leak tests.

#### STAGE-02 — migration rehearsal, rollback и nonprod release

**Статус: NOT STARTED.**

- **Цель и границы:** проверить clean install, upgrade, rollback/forward fix, RLS/grants/RPC, smoke, restore и health в отдельном nonprod.
- **Предусловия:** STAGE-01, full green integration CI, все migrations reviewed.
- **Acceptance / DoD:** повторяемый release checklist; rollback/recovery подтверждены; build artifact привязан к commit; staging credentials/dataset не попадают в demo/client; no prod writes.
- **Тесты и артефакты:** disposable environment migration/pgTAP, smoke/E2E, restore proof, deployment/rollback runbook.

### Этап 11 — Закрытый пилот

**Статус этапа: BLOCKED.** Реальный пилот нельзя выводить из готовности кода или результата локальных тестов.

#### PILOT-01 — пилотный сегмент, метрики и stop criteria

**Статус: BLOCKED до решений владельца.**

- **Цель и границы:** выбрать город, buyer type, supplier categories, ограниченный cohort, пилотный объём и способ поддержки.
- **Предусловия:** owner выбирает market/segment и подтверждает, кто может участвовать; legal/accounting review.
- **Acceptance / DoD:** для каждой метрики определены знаменатель, окно, источник, минимальный/целевой уровень, stop threshold и ответственный. Не выдумывать target без baseline.
- **Тесты и артефакты:** signed pilot charter, synthetic dashboard spec, escalation/rollback/stop checklist.

#### PILOT-02 — Product Ready / GO gate

**Статус: BLOCKED.**

- **Цель и границы:** собрать единый evidence pack перед возможностью закрытого пилота: business/legal, supplier acceptance, privacy/security, support, finance, delivery, reliability, accessibility и CI.
- **Предусловия:** все применимые task IDs DONE; production/live systems остаются закрытыми.
- **Acceptance / DoD:** каждый gate имеет owner, evidence link, review date и explicit GO/NO-GO; CI на конкретном release candidate зелёный; rollback/restore и support rehearsal подтверждены; owner отдельно разрешил конкретный pilot cohort, дату, scope и live operations.
- **Тесты и артефакты:** evidence pack, runbooks, test reports, legal/accounting sign-offs и signed owner approval.

#### PILOT-EXEC-01 — фактическое проведение пилота

**Статус: NOT STARTED; отдельное разрешение обязательно.**

- **Цель и границы:** ограниченный, контролируемый пилот с реальными участниками только в утверждённом scope. Реальные заказы/платежи/уведомления/данные не входят в текущую задачу.
- **Предусловия:** PILOT-02 GO и точное owner approval на операции, участников и лимиты.
- **Acceptance / DoD:** все stop criteria и incident escalation соблюдаются; данные собираются минимально; каждый заказ/branch прослеживаем; пилот закрыт или остановлен с отчетом по заранее выбранным метрикам.
- **Тесты и артефакты:** операционный checklist, cohort consent, monitoring, incident log и post-pilot report.

### Этап 12 — Решение о публичном запуске

**Статус этапа: NOT STARTED.** Публичный launch не является автоматическим продолжением пилота.

#### LAUNCH-01 — отдельное Go/No-Go публичного запуска

**Статус: NOT STARTED.**

- **Цель и границы:** владелец принимает решение по конкретному release commit, домену, дате, стране, категориям и уровню поддержки.
- **Предусловия:** пилотные критерии выполнены; legal/accounting/security/privacy/payment/delivery gates закрыты; unit economics и support capacity подтверждены.
- **Acceptance / DoD:** signed GO с approved build SHA, domain, launch limits, rollout/rollback, incident owner и budget; NO-GO причины зафиксированы и возвращают соответствующие задачи в BLOCKED/IN PROGRESS.
- **Тесты и артефакты:** final security review, restore/rollback drill, operational readiness, accessibility and localization sign-off, owner approval. До отдельного разрешения не публиковать и не деплоить.

## Сквозные Definition of Done

Каждое code изменение сохраняет применимые правила из [`AGENTS.md`](../AGENTS.md), [`security.md`](security.md), [`product-scope.md`](product-scope.md), [`tenant-foundation.md`](tenant-foundation.md) и [`supplier-suborder-workflow.md`](supplier-suborder-workflow.md):

- Сервер доверяет authenticated identity + membership + role + object ownership, а не клиентским ID или скрытым controls; grants/RLS проверяются парно.
- Buyer parent request и independent supplier suborders не смешивают статусы; принятие условий, резерв, confirmed order, fulfillment, receipt и payment — разные переходы.
- Цена/наличие имеют отдельные наблюдения и timestamps; stale/unknown блокирует либо требует явного подтверждения; snapshots immutable.
- Деньги хранятся в integer minor units, валюта указана явно; unit/pack/MOQ/step/delivery fee — отдельные размерности; FX запрещён без одобренной модели.
- Side-effecting writes атомарны, идемпотентны и имеют concurrency control; audit append-only; безопасные typed errors без PII/secrets/SQL details.
- Импорт ограничен по размеру/строкам, повторно валидируется сервером, не исполняет содержимое и не создаёт дублей.
- Любое новое внешнее сообщение, платёж, заказ, резерв, доставка, production connection или deployment имеет отдельный permission gate.
- Все результаты маркируются `local`, `ephemeral CI`, `approved nonprod/staging` или `production`; локальные synthetic tests не доказывают коммерческую, юридическую или hosted готовность.
- Для code PR требуются формат, lint, typecheck, unit/component coverage, build, применимые local/ephemeral Supabase tests и Playwright desktop/mobile/accessibility; меняющийся список required checks сверять в GitHub для свежего base/head.

## Что не считать решением

Не выводить из кода или статуса `platform-as-seller`: юридического продавца, комиссию, тарифы, налоги, счета, валюту/обмен, settlement, stock guarantee, сроки ответа, доставку, data retention, допустимость уведомлений или готовность к рынку. Каждое из этих решений должно быть явно подтверждено владельцем и, где применимо, профильным специалистом.
