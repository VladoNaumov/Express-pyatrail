
---

# Структура и роли (light-версия)

```
paytrail-app/
├─ package.json               # зависимости и скрипты (start/dev)
├─ server.js                  # точка входа: Express, hbs, middleware, маршруты
├─ src/
│  ├─ Config.js               # конфиг Paytrail и URL-хелперы (baseUrl/selfUrl)
│  ├─ Logger.js               # JSON-логгер (без SECRET_KEY), пишет в файлы
│  ├─ Views.js                # слой представления: регистрирует hbs-хелперы, рендерит result
│  ├─ PaytrailSystem.js       # бизнес-логика: create POST /payments, HMAC, верификация redirect/callback
│  └─ utils.js                # утилиты (safeEq, nowIso, writeMultiLogs и т. п.)
└─ views/
   ├─ layouts/
   │  └─ main.hbs             # общий макет (стили/обёртка)
   ├─ result.hbs              # страница результата оплаты (success/cancel)
   └─ error.hbs               # страница ошибок (404/500)
```

---

## Что за что отвечает

### `server.js`

* Создаёт `app = express()`.
* Настраивает **hbs**:

    * `app.set('view engine', 'hbs')`
    * `app.set('views', path.join(__dirname, 'views'))`
    * `Views.registerHelpers()` — кастомные хелперы (`euro`, `eq`, и т. п.).
* Middleware:

    * `express.urlencoded()` и `express.json()` — для обычных страниц/действий.
    * **Важно:** raw-body **только** для POST `/` или `/index` с `?action=callback`:

      ```js
      app.post(['/index', '/'], express.raw({ type: 'application/json' }), handler)
      ```
* Маршрутизация через query `?action=`:

    * `create` → `PaytrailSystem.createAndRedirect`
    * `success`/`cancel` → `PaytrailSystem.renderSuccessOrCancel`
    * `callback` → `PaytrailSystem.handleCallback`
* 404/ошибки → рендер `views/error.hbs`.
* `app.listen(PORT)` + лог в консоль и через `Logger`.

---

### `src/Config.js`

* Жёсткие настройки Paytrail (можно читать из `process.env`, **без .env**):

    * `MERCHANT_ID`, `SECRET_KEY`, `PAYTRAIL_ENDPOINT`
    * `FORCE_BASE_URL` (например, `https://www.encanta.fi/payment`)
    * `BACK_URL` (кнопка «Назад в магазин»)
    * пути к логам, флаг `DEBUG_LOGS`
* Хелперы URL:

    * `baseUrl(req)` — возвращает базовый URL (`FORCE_BASE_URL` или собранный из `req`)
    * `selfUrl(req, action)` — `baseUrl + ?action=...` (используется для redirect/callback ссылок)

---

### `src/Logger.js`

* `Logger.event(event, data)` — пишет JSON-строку в лог-файл(ы).
* Фильтрует чувствительные поля (например, `SECRET_KEY`).
* Основной лог: `paytrail.log` (+ при желании warn/error разносить в отдельные файлы).

---

### `src/Views.js`

* Регистрирует hbs-хелперы:

    * `euro(amount)` → формат `1590` → `15.90 €`
    * `eq(a, b)` → сравнение в шаблоне
* Метод `renderResult(res, action, data)` → рендер `views/result.hbs` с макетом `layouts/main.hbs`.

---

### `src/PaytrailSystem.js`

* **Создание платежа**:

    * Собирает body (stamp, amount, items, customer, redirectUrls, callbackUrls).
    * Готовит заголовки `checkout-*` + `signature` (HMAC-SHA256 по строке: отсортированные `k:v\n` + `\n` + raw body).
    * Делает `POST` на `PAYTRAIL_ENDPOINT`.
    * На `201` берёт `href` и `res.redirect(href)`. Иначе — рендерит `error.hbs`.
* **Верификация redirect (GET)**:

    * Берёт **все** `checkout-*` из **query**, сортирует по ключу, склеивает в `k:v\n...` + финальная `\n`, HMAC, сравнение с `signature` из query (timing-safe).
    * Логирует и рендерит `result.hbs`.
* **Обработка callback (POST)**:

    * Требуется **сырой body** (`req.rawBody`) и **заголовки** `checkout-*` + `signature`.
    * Собирает **значения** всех `checkout-*` (по алфавиту), конкатенирует `value\nvalue\n...` + `rawBody`, считает HMAC, сверяет (timing-safe).
    * На успех → `200 OK`, иначе `400 ERR`.
    * Поддерживает GET-фоллбек на случай прокси/WAF (но помечает как `warn`).

---

### `src/utils.js`

* `safeEq(a, b)` — тайминг-безопасное сравнение hex-строк.
* `nowIso()` — ISO без миллисекунд.
* `writeMultiLogs(event, payload)` — запись в общий лог + доп. файлы для warn/error (если используешь разнесение).

---

### `views/*`

* `layouts/main.hbs` — базовый HTML-макет (стили, контейнер).
* `result.hbs` — показывает `tx/status/provider/amount/reference/stamp` и кнопки:

    * success → «Назад в магазин»
    * cancel → «Попробовать снова» + «Назад в магазин»
* `error.hbs` — простая страница ошибок.

---

## Поток запросов (по action)

1. **Создать платёж**

```
GET /index?action=create
  → PaytrailSystem.createAndRedirect
    → POST https://services.paytrail.com/payments (HMAC заголовков + JSON body)
    ← 201 + { href, transactionId, ... }
  → 302 Redirect на href (страница оплаты Paytrail)
```

2. **Возврат пользователя (success/cancel)**

```
GET /index?action=success|cancel&checkout-*&signature
  → PaytrailSystem.renderSuccessOrCancel
    → verifyRedirectSignature(query)
  → res.render('result.hbs', { ... })
```

3. **Server-to-server callback**

```
POST /index?action=callback
  headers: checkout-*, signature
  body:    RAW JSON
  → PaytrailSystem.handleCallback
    → verify HMAC: values(checkout-*) (sorted) + rawBody
  → 200 'OK' / 400 'ERR'
```

---

## Маршруты (в твоём `server.js`)

| Метод | Путь(и)       | Логика                                                            |
| ----: | ------------- | ----------------------------------------------------------------- |
|   GET | `/`, `/index` | по `?action=`: create / success / cancel / callback (GET-фоллбек) |
|  POST | `/`, `/index` | raw JSON body + `?action=callback`                                |

> Если хочешь явные URL — легко добавить алиасы `/payment/create`, `/payment`, но текущая схема уже работает.

---

## Запуск

```bash
npm i
npm run start        # или: node server.js
# при разработке: npm i -D nodemon && npm run dev
```

