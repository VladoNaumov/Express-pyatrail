const config = require('../config/paytrail');
const logger = require('../utils/logger');
const svc = require('../services/paytrailService');

// GET /payment/create → создаём платёж и редиректим на Paytrail
async function createAndRedirect(req, res, next) {
    try {
        const href = await svc.createPayment(req);
        return res.redirect(href);
    } catch (e) {
        return next(e);
    }
}

// GET /payment?action=success|cancel → страница результата
function renderResult(req, res) {
    const action = req.query.action === 'success' ? 'success' : 'cancel';
    const ok = svc.verifyRedirectSignature(req.query);

    const data = {
        title: action === 'success' ? 'Оплата успешно завершена' : 'Оплата отменена',
        note:
            action === 'success'
                ? (ok ? 'Подпись валидна. Спасибо за оплату!' : 'Подпись не подтверждена.')
                : (ok ? 'Подпись валидна, отмена/ошибка.' : 'Подпись не подтверждена.'),

        // Покажем основные параметры, если пришли
        tx: req.query['checkout-transaction-id'] || '',
        status: req.query['checkout-status'] || '',
        provider: req.query['checkout-provider'] || '',
        amount: req.query['checkout-amount'] || '',
        reference: req.query['checkout-reference'] || '',
        stamp: req.query['checkout-stamp'] || '',

        backUrl: config.BACK_URL,
        isSuccess: action === 'success',
    };

    logger.event('redirect_' + action, { signature_ok: ok, ...data });
    res.render('result', data);
}

// POST /payment?action=callback → серверный коллбэк (Paytrail → наш сервер)
function handleCallback(req, res) {
    const { valid } = svc.verifyCallback(req);
    logger.event('callback_event', { valid, url: req.originalUrl });
    res.status(valid ? 200 : 400).send(valid ? 'OK' : 'ERR');
}

module.exports = { createAndRedirect, renderResult, handleCallback };
