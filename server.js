'use strict';

const path = require('path');
const express = require('express');

const Config = require('./src/Config');
const Logger = require('./src/Logger');
const Views = require('./src/Views');
const PaytrailSystem = require('./src/PaytrailSystem');

const app = express();

// ===== Handlebars (hbs) =====
app.set('view engine', 'hbs');
app.set('views', path.join(__dirname, 'views'));
Views.registerHelpers();         // наши кастомные хелперы
Views.registerHbs(app);          // layouts/partials, if any

// ===== Обычные парсеры для create и redirect =====
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

// Главная точка (как index.php?action=...)
app.get(['/index', '/'], async (req, res) => {
    const action = String(req.query.action || 'create');

    try {
        switch (action) {
            case 'success':
                return PaytrailSystem.renderSuccessOrCancel(req, res, 'success');
            case 'cancel':
                return PaytrailSystem.renderSuccessOrCancel(req, res, 'cancel');
            case 'callback':
                // Если Paytrail зайдёт GET-ом — поддержим GET-фоллбек
                return PaytrailSystem.handleCallback(req, res);
            case 'create':
            default:
                return PaytrailSystem.createAndRedirect(req, res);
        }
    } catch (e) {
        Logger.event('app_error', { action, error: String(e) });
        return res.status(500).render('error', { title: 'Internal error', message: 'Internal error' });
    }
});

// ===== POST callback c RAW JSON (для подписи нужен сырой body) =====
app.post(['/index', '/'], express.raw({ type: 'application/json' }), (req, res, next) => {
    try {
        req.rawBody = req.body ? req.body.toString('utf8') : '';
    } catch {
        req.rawBody = '';
    }
    const action = String(req.query.action || '');
    if (action === 'callback') {
        return PaytrailSystem.handleCallback(req, res);
    }
    return next();
});

// 404
app.use((req, res) => {
    res.status(404).render('error', { title: 'Not Found', message: 'Not Found' });
});

// Запуск
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    Logger.event('server_started', { port: PORT });
    console.log(`Server listening on http://localhost:${PORT}`);
});
