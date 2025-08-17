// Загружаем переменные из .env (PORT, MERCHANT_ID и т.д.)
require('dotenv').config();

// Библиотеки Express и полезные помощники
const createError = require('http-errors');    // делает объект ошибки с кодом (404, 500 и т.п.)
const express = require('express');            // сам фреймворк
const path = require('path');                  // работа с путями (склеить папки/файлы)
const cookieParser = require('cookie-parser'); // чтение cookies из запроса
const morgan = require('morgan');              // красивый лог запросов в консоль
const hbs = require('hbs');                    // шаблонизатор Handlebars для Express

// Наши маршруты оплаты вынесены в отдельный файл
const webRouter = require('./routes/web');

// Создаём экземпляр приложения Express
const app = express();

/* ---------------------------------------------------
   НАСТРОЙКА ШАБЛОНИЗАТОРА (HTML-страницы через Handlebars)
   ---------------------------------------------------
   - views: где лежат шаблоны
   - view engine: чем их рендерить (hbs = Handlebars)
*/
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'hbs');
// Если захотим подключать "куски" шаблонов (partials), раскомментируй строку ниже
// hbs.registerPartials(path.join(__dirname, 'views/partials'));

/* ---------------------------------------------------
   СЧИТЫВАЕМ "СЫРОЕ" ТЕЛО ЗАПРОСА (rawBody)
   ---------------------------------------------------
   Зачем? Paytrail в server-to-server callback подписывает (HMAC) именно "сырое" тело.
   Если мы сначала пропустим запрос через JSON-парсер, "сырое" тело потеряется.
   Поэтому ПОМЕЩАЕМ ЭТО МИДЛВАР ДО express.json()/urlencoded().
*/
app.use((req, res, next) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));                 // собираем кусочки тела запроса
    req.on('end', () => {
        if (chunks.length) req.rawBody = Buffer.concat(chunks).toString('utf8'); // сохраняем как строку
        next();
    });
});

/* ---------------------------------------------------
   БАЗОВЫЕ МИДЛВАРЫ (общие для всех запросов)
   ---------------------------------------------------
   - morgan: логирует "GET /path 200 12ms"
   - express.json / urlencoded: парсят тело запроса в req.body
   - cookieParser: делает req.cookies
   - express.static: раздача статики (картинки, css, js) — в демо не нужно
*/
app.use(morgan('dev'));
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());

// Если нужно раздавать статику из папки public — раскомментируй строку ниже
// app.use(express.static(path.join(__dirname, 'public')));

/* ---------------------------------------------------
   МАРШРУТЫ ПРИЛОЖЕНИЯ
   ---------------------------------------------------
   Всё, что начинается с /payment, обрабатывает routes/web.js
   Примеры:
   - GET /payment/create   → создать платёж и редирект на Paytrail
   - GET /payment          → результат (success/cancel)
   - POST /payment         → callback от Paytrail (сервер-сервер)
*/
app.use('/payment', webRouter);

/*
   Создаём ошибку 404 и передаём в общий обработчик ошибок ниже.
*/
app.use((req, res, next) => next(createError(404)));

/* ---------------------------------------------------
   ОБЩИЙ ОБРАБОТЧИК ОШИБОК
   ---------------------------------------------------
   Сюда попадают все ошибки из роутов/сервера.
   Мы отвечаем кодом (err.status или 500) и рендерим views/error.hbs.
*/
app.use((err, req, res, next) => {
    res.status(err.status || 500);
    res.render('error', {
        status: err.status || 500,
        message: err.message
    });
});

// Экспортируем приложение — его подхватит bin/www и запустит HTTP-сервер
module.exports = app;
