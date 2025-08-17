const crypto = require('crypto');
const axios = require('axios');
const { MERCHANT_ID, SECRET_KEY, PAYTRAIL_ENDPOINT, selfUrl } = require('../config/paytrail');
const logger = require('../utils/logger');

// Вспомогалка для HMAC-SHA256 (hex)
const hmac = (s, key) => crypto.createHmac('sha256', key).update(s).digest('hex');

// Формируем заголовки для подписания запроса на Paytrail
function headersForSign(method) {
    return {
        'checkout-account': String(MERCHANT_ID),
        'checkout-algorithm': 'sha256',
        'checkout-method': method.toUpperCase(),
        'checkout-nonce': crypto.randomBytes(16).toString('hex'),
        'checkout-timestamp': new Date().toISOString(),
    };
}

// 1) Создаём платёж и возвращаем ссылку href для редиректа
async function createPayment(req) {
    const stamp = 'order-' + Math.floor(Date.now() / 1000); // наш ID заказа

    const body = {
        stamp,
        reference: stamp,                // Paytrail может заменить reference у провайдеров — это нормально
        amount: 1590,                    // 15.90 €
        currency: 'EUR',
        language: 'FI',
        items: [{
            unitPrice: 1590, units: 1, vatPercentage: 24,
            productCode: 'SKU-001', description: 'Test product', category: 'General'
        }],
        customer: { email: 'test@example.com', firstName: 'Test', lastName: 'User', phone: '+358501234567' },

        // Куда вернуть пользователя (GET): здесь подпись проверяется только по checkout-* (без тела)
        redirectUrls: {
            success: selfUrl(req, { action: 'success' }),
            cancel: selfUrl(req, { action: 'cancel' }),
        },

        // Куда бить server-to-server (POST): тут подпись рассчитывается по заголовкам checkout-* + raw body
        callbackUrls: {
            success: selfUrl(req, { action: 'callback' }),
            cancel: selfUrl(req, { action: 'callback' }),
        },
    };

    // Подпись запроса на создание платежа: каноническая строка = отсортированные "k:v\n" заголовков + "\n" + body
    const hdr = headersForSign('POST');
    const canonical = Object.keys(hdr).sort().map(k => `${k}:${hdr[k]}`).join('\n') + '\n' + JSON.stringify(body);
    const signature = hmac(canonical, SECRET_KEY);

    logger.event('payment_create_request', { endpoint: PAYTRAIL_ENDPOINT, headers: hdr, body });

    // Отправляем в Paytrail
    const resp = await axios.post(PAYTRAIL_ENDPOINT, body, {
        headers: { 'Content-Type': 'application/json; charset=utf-8', ...hdr, signature },
        validateStatus: () => true,
    });

    logger.event('payment_create_response', { http_code: resp.status, body: resp.data });

    if (resp.status !== 201) {
        throw new Error(`Paytrail error (${resp.status}): ${JSON.stringify(resp.data)}`);
    }

    // Берём адрес платёжной страницы
    const href = resp.data?.href || resp.data?.providers?.[0]?.url;
    if (!href) throw new Error('Нет ссылки на оплату (href)');
    return href;
}

// 2) Проверка подписи в redirect (success/cancel) — тут подписываются только checkout-* из QUERY
function verifyRedirectSignature(query) {
    const sig = (query.signature || '').toLowerCase();
    if (!sig) return false;

    // Берём все параметры checkout-*, сортируем по имени (в нижнем регистре)
    const entries = Object.entries(query)
        .filter(([k]) => k.toLowerCase().startsWith('checkout-'))
        .map(([k, v]) => [k.toLowerCase(), String(v)])
        .sort((a, b) => a[0].localeCompare(b[0]));

    if (!entries.length) return false;

    // Каноническая строка: "k:v\n" + ... + "\n" (без body)
    const canonical = entries.map(([k, v]) => `${k}:${v}`).join('\n') + '\n';
    const calc = hmac(canonical, SECRET_KEY);

    return crypto.timingSafeEqual(Buffer.from(calc), Buffer.from(sig));
}

// 3) Проверка подписи в callback (POST) — здесь в канонической строке значения checkout-* заголовков + rawBody
function verifyCallback(req) {
    const headers = Object.fromEntries(
        Object.entries(req.headers).map(([k, v]) => [k.toLowerCase(), Array.isArray(v) ? v.join(',') : v])
    );
    const sigHead = (headers['signature'] || '').toLowerCase();

    const canonHeaders = Object.keys(headers)
        .filter(k => k.startsWith('checkout-'))
        .sort()
        .map(k => headers[k]);

    // Обязательно берём rawBody (мы сохранили его в app.js до парсеров)
    const rawBody = typeof req.rawBody === 'string' ? req.rawBody : JSON.stringify(req.body || {});
    const canonical = canonHeaders.join('\n') + rawBody;

    const calc = hmac(canonical, SECRET_KEY);
    const valid = sigHead && calc.length === sigHead.length &&
        crypto.timingSafeEqual(Buffer.from(calc), Buffer.from(sigHead));

    return { valid };
}

module.exports = { createPayment, verifyRedirectSignature, verifyCallback };
