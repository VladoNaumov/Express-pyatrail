'use strict';

const path = require('path');
const hbs = require('hbs');

class Views {
    // Регистрируем хелперы hbs
    static registerHelpers() {
        hbs.registerHelper('euro', function (amount) {
            const n = Number(amount);
            if (Number.isFinite(n)) return (n / 100).toFixed(2) + ' €';
            return '';
        });
    }

    // layouts / partials (если понадобятся)
    static registerHbs(app) {
        // Если будут partials:
        // hbs.registerPartials(path.join(__dirname, '..', 'views', 'partials'));
        app.set('views', path.join(__dirname, '..', 'views'));
    }

    // Универсальный рендер результата (success/cancel)
    static renderResult(res, action, data) {
        const title = action === 'success' ? 'Оплата успешно завершена' : 'Оплата отменена';
        const ctx = {
            layout: 'main',
            title,
            action,
            note: data.note || '',
            tx: String(data.tx ?? ''),
            status: String(data.status ?? ''),
            provider: String(data.provider ?? ''),
            amount: data.amount,
            reference: String(data.reference ?? ''),
            stamp: String(data.stamp ?? ''),
            backUrl: data.backUrl,
            retryUrl: data.retryUrl
        };
        return res.status(200).render('result', ctx);
    }
}

module.exports = Views;
