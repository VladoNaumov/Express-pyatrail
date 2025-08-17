require('dotenv').config();

// Конфиг Paytrail + помощники URL
require('dotenv').config();

function baseUrl(req) {
    // Если задан принудительный базовый URL — используем его (так проще и надёжнее)
    if (process.env.FORCE_BASE_URL && process.env.FORCE_BASE_URL.trim() !== '') {
        return process.env.FORCE_BASE_URL.replace(/\/$/, '');
    }
    // Иначе собираем из запроса (протокол, хост, baseUrl)
    const proto = req.get('x-forwarded-proto') || req.protocol || 'http';
    const host = req.get('host');
    const base = req.baseUrl || '';
    return `${proto}://${host}${base}`.replace(/\/$/, '');
}

function selfUrl(req, query) {
    // Сформировать полный URL текущего контроллера с query-параметрами
    const q = typeof query === 'string' ? query : new URLSearchParams(query).toString();
    return `${baseUrl(req)}/?${q}`;
}

module.exports = {
    MERCHANT_ID: process.env.MERCHANT_ID,
    SECRET_KEY: process.env.SECRET_KEY,
    PAYTRAIL_ENDPOINT: process.env.PAYTRAIL_ENDPOINT,
    BACK_URL: process.env.BACK_URL,
    baseUrl,
    selfUrl,
};
