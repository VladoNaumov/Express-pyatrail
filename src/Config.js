'use strict';

const path = require('path');

class Config {
    static MERCHANT_ID = Number(process.env.MERCHANT_ID || 375917);
    static SECRET_KEY = String(process.env.SECRET_KEY || 'SAIPPUAKAUPPIAS');
    static PAYTRAIL_ENDPOINT = 'https://services.paytrail.com/payments';

    // Можно задать жёстко (или пусто — тогда соберём из req)
    static FORCE_BASE_URL = process.env.FORCE_BASE_URL || 'https://www.encanta.fi/payment';

    static YOUR_DOMAIN = process.env.YOUR_DOMAIN || 'www.encanta.fi';
    static APP_PATH = process.env.APP_PATH || '/payment';

    static BACK_URL = process.env.BACK_URL || 'https://encanta.fi/';

    static LOG_FILE = process.env.LOG_FILE || path.join(__dirname, '..', 'paytrail.log');
    static DEBUG_LOGS = String(process.env.DEBUG_LOGS || 'true') === 'true';

    static baseUrl(req) {
        if (this.FORCE_BASE_URL && this.FORCE_BASE_URL !== '') {
            return this.FORCE_BASE_URL.replace(/\/+$/, '');
        }
        const scheme = (req.protocol || 'http');
        const host = req.get('host') || this.YOUR_DOMAIN;
        const base = this.APP_PATH && this.APP_PATH !== ''
            ? this.APP_PATH
            : (req.baseUrl || '/');
        return (scheme + '://' + host + base).replace(/\/+$/, '');
    }

    static selfUrl(req, query) {
        return `${this.baseUrl(req)}/index?action=${query}`;
    }
}

module.exports = Config;
