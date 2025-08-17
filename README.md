# Структура проекта (что за что отвечает)

```
Express-paytrail
│
├─ .env                         — секреты/URLs (MERCHANT_ID, SECRET_KEY, FORCE_BASE_URL, BACK_URL, PAYTRAIL_ENDPOINT, PORT, HOST)
├─ package.json                 — зависимости и скрипты (start/dev)
├─ app.js                       — настройка Express: view-движок (hbs), middleware, rawBody, маршруты, 404/ошибки
│
├─ bin/
│   └─ www                      — минимальная точка входа (#!/usr/bin/env node): просто require('../bootstrap/server') и запуск
│
├─ bootstrap/
│   └─ server.js                — создание HTTP-сервера (http.createServer(app)), listen, дружелюбный лог, обработка ошибок (EACCES/EADDRINUSE/прочее)
│
├─ config/
│   ├─ server.js                — конфиг сервера (порт/хост/env), читает .env
│   └─ paytrail.js              — конфиг Paytrail + помощники baseUrl()/selfUrl()
│
├─ routes/
│   └─ web.js                   — маршруты: GET /payment/create, GET /payment (success/cancel), POST /payment (callback)
│
├─ controllers/
│   └─ PaymentController.js     — тонкий слой: читает req.query/req.body, зовёт сервис, рендерит views/result.hbs
│
├─ services/
│   └─ paytrailService.js       — бизнес-логика: POST /payments, HMAC-подписи, верификация redirect/callback
│
├─ utils/
│   └─ logger.js                — простой JSON-лог (без SECRET_KEY) → файл (например, paytrail.log или storage/logs/paytrail.log)
│
└─ views/
   ├─ error.hbs                 — страница ошибок (404/500)
   └─ result.hbs                — страница результата оплаты (tx/status/amount и т.д.)

```

Окей, пройдёмся по **инициализации сервера** шаг-за-шагом, прямо «по файлам» — от команды запуска до готового HTTP-слушателя и подключённых маршрутов.

---

## 0) Старт из `package.json`

* Ты выполняешь `npm run start` (или `node bin/www` / `nodemon bin/www`).
* Скрипт запускает файл `bin/www`.

---

## 1) `bin/www` — минимальная точка входа

* Файл без расширения, с шебангом `#!/usr/bin/env node`.
* Делает ровно одно: `require('../bootstrap/server')` и вызывает экспортируемую функцию `createServer()`.

    * Никаких `dotenv`, портов, логики — всё вынесено.

**Итог:** управление передано в bootstrap-уровень.

---

## 2) `bootstrap/server.js` — создание и запуск HTTP-сервера

* Импортирует:

    * `const http = require('http')`
    * `const app = require('../app')` → **это подтянет Express-приложение и настроит его** (см. шаг 3)
    * `const serverConfig = require('../config/server')` → **это подтянет конфигурацию порта/хоста и прочее** (см. шаг 4)
* Создаёт сервер: `const server = http.createServer(app)`.
* Запускает прослушивание: `server.listen(serverConfig.port, ...)`.
* Печатает дружелюбный лог `http://HOST:PORT`.
* Вешает обработчики ошибок запуска (`EACCES`, `EADDRINUSE`, «прочее»).

**Итог:** TCP-порт открыт, сервер слушает, Node.js HTTP-уровень готов проксировать запросы в Express.

---

## 3) `app.js` — инициализация Express-приложения

Когда `bootstrap/server.js` делает `require('../app')`, выполняются шаги:

* Создаётся `const app = express()`.
* Настраивается view-движок (Handlebars / hbs): `app.set('views', ...)`, `app.set('view engine', 'hbs')`.
* Подключаются middleware:

    * парсеры тела (`express.json()`, `express.urlencoded()`), твоя логика `rawBody`, статика и т. п.
    * любые CORS/helmet/компрессия — если добавлены.
* Подключаются маршруты:

    * `const webRoutes = require('./routes/web')`
    * `app.use(webRoutes)`
* Регистрируются обработчики 404 и ошибок (error handler).

**Итог:** Express готов принимать `(req, res)`, маршруты навешаны, ошибки обрабатываются.

> Важно: `app.js` **не** слушает порт и **не** трогает `.env`. Это чистая конфигурация Express.

---

## 4) `config/server.js` — конфигурация окружения сервера

Когда `bootstrap/server.js` импортирует `../config/server`:

* Выполняется `require('dotenv').config()` (обычно **однажды** в проекте — здесь или в отдельном `config/app.js`, чтобы не дублировать).
* Из `.env` читаются `PORT`, `HOST`, `NODE_ENV` и пр.
* Экспортируется объект вида:

  ```js
  module.exports = {
    port: parseInt(process.env.PORT, 10) || 3000,
    host: process.env.HOST || 'localhost',
    env: process.env.NODE_ENV || 'development',
  };
  ```

**Итог:** bootstrap знает, на каком адресе поднимать сервер и что писать в лог.

---

## 5) `routes/web.js` — подключение маршрутов

Когда `app.js` делает `require('./routes/web')`:

* Определяются маршруты:

    * `GET /payment/create` → `PaymentController.createAndRedirect`
    * `GET /payment` (success/cancel) → `PaymentController.renderResult`
    * `POST /payment` (callback) → `PaymentController.handleCallback`
* Экспортируется `router`, который `app.js` монтирует в приложение.

**Итог:** URL-ы привязаны к контроллеру.

---

## 6) `controllers/PaymentController.js` — тонкий слой над HTTP

Когда маршруты вызывают методы контроллера:

* Контроллер **читает вход** (`req.query`, `req.body`).
* Делегирует работу в `services/paytrailService.js`.
* По результату рендерит `views/result.hbs` или делает редирект/ответ JSON.
* Логи событий — через `utils/logger.js` (где это уместно).

**Итог:** HTTP-уровень остаётся тонким; вся бизнес-логика — в сервисе.

---

## 7) `services/paytrailService.js` — бизнес-логика Paytrail

При первом импорте сервиса:

* Подтягивает конфиг Paytrail: `require('../config/paytrail')`.

    * Там же (обычно) вызывается `require('dotenv').config()` **или** считываются значения, которые уже доступны после единожды вызванного `dotenv` (важно не дублировать везде).
* Готовит функции:

    * создание платежа (POST `/payments`) с HMAC-подписью;
    * верификация redirect/callback (проверка заголовков и сигнатур);
    * сбор/нормализация полезных полей (amount, reference, status и т. п.).
* Использует `utils/logger.js` для логов без утечек `SECRET_KEY`.

**Итог:** единая точка Paytrail-интеграции, чистая и тестируемая.

---

## 8) `config/paytrail.js` — конфиг и помощники для Paytrail

* Берёт из `.env`: `MERCHANT_ID`, `SECRET_KEY`, `PAYTRAIL_ENDPOINT`, `FORCE_BASE_URL`, `BACK_URL` и т. п.
* Экспортирует:

    * «сырые» значения конфигурации;
    * **помощники** `baseUrl()` и `selfUrl(req)`:

        * `baseUrl()` решает, откуда брать базовый URL (FORCE\_BASE\_URL или вычисление из `req`/хедеров/прокси);
        * `selfUrl(req)` — удобный конструктор полного URL запроса, полезен в верификации/логах/редиректах.

**Итог:** вся настройка Paytrail централизована, без захардкоженных URL в коде сервиса/контроллера.

---

## 9) `utils/logger.js` — единая точка логирования

* Даёт функции для JSON-логов в файл (например, `storage/logs/paytrail.log`).
* Обязательно **фильтрует чувствительные данные** (не пишет `SECRET_KEY`, HMAC и т. п.).
* Может добавлять timestamp, уровень, requestId/nonce.

**Итог:** одинаковый формат логов и безопасная запись.

---

## 10) `views/` — шаблоны Handlebars

* `result.hbs` — конечная страница результата оплаты (tx/status/amount и т. п.).
* `error.hbs` — fallback для 404/500 (используется error-handler’ом в `app.js`).

**Итог:** UI слой для ответов, читаемый и отделённый от логики.

---

# Коротко: «цепочка инициализации»

1. **`npm start` → `bin/www`** (вход)
2. **`bin/www` → `bootstrap/server.js`** (создаём/запускаем HTTP-сервер)
3. **`bootstrap/server.js` → `config/server.js`** (PORT/HOST из `.env`)
4. **`bootstrap/server.js` → `app.js`** (инициализация Express: view/mw/routes/errors)
5. **`app.js` → `routes/web.js` → `controllers/PaymentController.js`**
6. **Контроллер → `services/paytrailService.js` → `config/paytrail.js` + `utils/logger.js`**
7. Ответ — через `views/*.hbs` или JSON/redirect.

Если хочешь, могу сгенерировать минимальные заготовки файлов под эту схему (готовые к копипасте).

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

