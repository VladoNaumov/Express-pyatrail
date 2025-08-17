# Структура проекта (что за что отвечает)

```
Express-pyatrail
│
├─ .env                      — креды/URLs (MERCHANT_ID, SECRET_KEY, FORCE_BASE_URL, BACK_URL, PAYTRAIL_ENDPOINT)
├─ app.js                    — настройка Express: view-движок (hbs), middleware, rawBody, маршруты, 404/ошибки
├─ package.json              — зависимости и скрипты (start/dev)
│
├─ bin/  
│    └─ www                  — запуск HTTP-сервера (читает PORT из .env)
│                     
├─ config/
│  └─ paytrail.js            — конфиг Paytrail + помощники baseUrl()/selfUrl()
│
├─ controllers/
│  └─ PaymentController.js   — тонкий слой: читает req.query/req.body, зовёт сервис, рендерит views/result.hbs
│
├─ services/
│  └─ paytrailService.js     — бизнес-логика: создание платежа (POST /payments), HMAC-подписи, верификация redirect/callback
│
├─ utils/
│  └─ logger.js              — простой JSON-лог в paytrail.log (без SECRET_KEY)
│
├─ routes/
│  └─ web.js             — маршруты: GET /payment/create, GET /payment (success/cancel), POST /payment (callback)
│
└─ views/
   ├─ error.hbs              — страница ошибок (404/500)
   └─ result.hbs             — страница результата оплаты (показывает tx/status/amount и т.д.)
```

Доп. файлы во время работы:

* `paytrail.log` — логи (создаётся автоматически).
* (опционально) `public/` — не используется в демо.

# Схема роутинга (эндпоинты)

| Метод | Путь              | Что делает                                       |
| ----: | ----------------- | ------------------------------------------------ |
|   GET | `/payment/create` | Создаёт платёж в Paytrail и редиректит на оплату |
|   GET | `/payment`        | Страница после возврата (success/cancel)         |
|  POST | `/payment`        | Server-to-server callback от Paytrail            |

# Схема потока (sequence)

## 1) Создание платежа

```
Браузер ──GET /payment/create──▶ routes/web.js
   └─▶ controllers/paymentController.createAndRedirect
        └─▶ services/paytrailService.createPayment
             └─▶ Paytrail API: POST /payments (HMAC заголовков + JSON body)
             ◀─ 201 + { href, transactionId, ... }
        ◀─ redirect URL (href)
◀─ HTTP 302 Redirect на платёжную страницу Paytrail
```

## 2) Возврат пользователя (success/cancel)

```
Paytrail ──GET {BASE_URL}?action=success|cancel&checkout-*+signature──▶ controllers/paymentController.renderResult
   └─▶ services.paytrailService.verifyRedirectSignature(query)  // HMAC по checkout-* (без body)
   └─▶ res.render('result.hbs', {..., isSuccess, signature_ok})
◀─ HTML (result.hbs)
```

## 3) Server-to-server callback

```
Paytrail ──POST {BASE_URL}?action=callback (headers: checkout-*, signature; body: JSON)──▶ controllers.paymentController.handleCallback
   └─▶ services.paytrailService.verifyCallback(req)
        └─ собирает checkout-* из headers (в алф. порядке) + rawBody
        └─ HMAC-SHA256 с SECRET_KEY
   └─▶ 200 'OK' (если подпись валидна) / 400 'ERR'
◀─ HTTP 200/400
```

# Схема конфигурации (.env)

* `PORT` — порт локального сервера.
* `MERCHANT_ID` — Paytrail merchant id.
* `SECRET_KEY` — Paytrail secret key (используется в HMAC).
* `PAYTRAIL_ENDPOINT` — `https://services.paytrail.com/payments`.
* `FORCE_BASE_URL` — базовый URL для редиректа/коллбэка:

    * **локально:** `http://localhost:3000/payment`
    * **на проде:** `https://www.encanta.fi/payment`
* `BACK_URL` — кнопка «Назад в магазин» на result.hbs.

# Слойная схема (аналог Laravel-слоёв)

```
Routes        →   Controllers                →      Services                      →   External
(web.js)      (PaymentController.js)            (paytrailService.js)               (Paytrail)
    │                     │                                │
    ├── create ─────────► │ createAndRedirect ───────────► │ createPayment ──POST────►  /payments
    │                     │                                │                    ◄───── 201 + href
    │                     │◄──────────── redirect ◄────────┘
    │
    ├── GET /            │ renderResult ────────────────►  verifyRedirectSignature
    │                     │◄────────── render(result.hbs)
    │
    └── POST /           │ handleCallback ─────────────►  verifyCallback (headers+rawBody HMAC)
                          │◄────────── 200/400
```

