const http = require('http');
// Подключаем Express-приложение (наш app.js)
// В Laravel это аналогично загрузке Kernel (HTTP kernel), где регистрируются роуты, middleware и т.п.
const app = require('../app');

// Подключаем настройки сервера (порт, хост и т.д.)
// В Laravel это обычно .env → config/app.php
const config = require('../config/server');

// В Node.js есть встроенный модуль 'http', через который реально поднимается сервер.
// Express сам по себе — это только "обработчик запросов".
// Поэтому мы создаём http-сервер и прокидываем туда app.
const http = require('http');

/**
 * Создаём и запускаем сервер
 * В Laravel этим занимается php-fpm или artisan serve,
 * а здесь — мы вручную вызываем http.createServer().
 */
function createServer() {
    // Создаём сервер и говорим: "каждый входящий запрос обрабатывай через наше Express-приложение"
    const server = http.createServer(app);

    // Говорим серверу слушать нужный порт и хост (например, http://localhost:3000)
    server.listen(config.port, () => {
        console.log(`🚀 Server running at http://${config.host}:${config.port}`);
    });

    /**
     * Обработка ошибок запуска сервера
     * (В Laravel artisan serve сам пишет "address already in use").
     */
    server.on('error', (err) => {
        // Ошибка: у процесса нет прав слушать порт (например, <1024 без root)
        if (err.code === 'EACCES') {
            console.error(`Port ${config.port} requires elevated privileges`);
            process.exit(1); // завершаем процесс с ошибкой
        }

        // Ошибка: порт уже занят другим процессом
        if (err.code === 'EADDRINUSE') {
            console.error(`Port ${config.port} is already in use`);
            process.exit(1);
        }

        // Любая другая ошибка
        console.error(err);
        process.exit(1);
    });

    // Возвращаем объект server (вдруг где-то нужно использовать, например для WebSocket)
    return server;
}

// Экспортируем функцию, чтобы можно было вызвать createServer() из bin/www или index.js
// В Laravel обычно artisan или public/index.php запускают всё приложение.
module.exports = createServer;

