# A11Y-MANUAL-01 — локальный клавиатурный/reflow checklist

**Среда:** integration branch @ `31dd4581eb915776ca2101ce7ad94486c4b69c8b`, feature-ветка `coder-a/a11y-manual-01-2026-11-26`. Chromium (Playwright), desktop + mobile projects, локальный mocked Supabase build, только синтетические данные. Внешних пользователей и устройств нет.

## Проверенное

| Проверка            | Сценарий                                                                                                                     | Результат                                    |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| Порядок фокуса      | От поля Email → Tab → пароль → Tab → кнопка «Войти»; Enter отправляет форму                                                  | PASS (`account-flow`, keyboard-only sign-in) |
| Ошибка формы        | `/auth/v1/token` возвращает `invalid_credentials`; `role="alert"` содержит безопасный текст без SQL/внутренних деталей       | PASS                                         |
| Фокус после ошибки  | Фокус возвращается на активную кнопку submit, а не теряется в `body` (исправлено в `AccountWorkspace`)                       | PASS                                         |
| Доступность select  | В черновой корзине `Точка покупателя` достигается фокусом, выбирается ArrowDown+Enter, review обновляется                    | PASS (`draft-cart-review`, keyboard/reflow)  |
| Submit с клавиатуры | Кнопка «Создать запрос закупки» достигается фокусом и активируется Enter; dialog подтверждения принимается                   | PASS                                         |
| Reflow 320px        | После регистрации запроса `document.scrollWidth <= clientWidth` на мобильном viewport                                        | PASS                                         |
| Labels / roles      | Email, пароль, точка покупателя, причина отклонения имеют labels; ошибки и статусы используют `role="alert"`/`role="status"` | PASS (component + E2E assertions)            |
| Automated axe       | WCAG 2.1 A/AA gate на всех reachable демо-экранах                                                                            | PASS (automated gate, см. A11Y-AUTO-01)      |

## Изменение в коде

`AccountAuth` теперь возвращает фокус на кнопку submit после ошибки входа (через `requestAnimationFrame`, когда кнопка снова активна). Это реальный дефект, найденный клавиатурной проверкой.

## Ограничения (честно)

- **Screen reader не проверен**: в окружении нет NVDA/JAWS/VoiceOver и человека, который провёл бы прослушивание. Эта часть DoD остаётся открытой; задачу нельзя называть полным ручным accessibility sign-off.
- Browser zoom не эмулировался; проверен только reflow на viewport 320px как прокси.
- Не проверялись иные браузеры/устройства и реальные пользователи с нарушениями зрения.

## Gate

`npm run verify:full` 320 тестов; `npm run e2e:ci` — 55 passed / 3 skipped после добавления двух клавиатурных сценариев (desktop + mobile); `npm audit` 0. Точные числа подтверждаются PR-запусками и post-merge CI в roadmap.
