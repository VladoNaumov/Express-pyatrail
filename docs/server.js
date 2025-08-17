// server.js
'use strict';

/**
 * ООП-версия Paytrail демо-интеграции (один файл, Node.js + Express).
 * Слои:
 *  - Config:            настройки
 *  - Logger:            логи (json-строки)
 *  - Views:             HTML-страницы для success/cancel
 *  - PaytrailSystem:    логика (создать платёж, подписи, callback)
 *  - App (Express):     маршрутизация экшенов
 *
 * Тестовые креды Paytrail (Normal merchant):
 *   MERCHANT_ID=375917
 *   SECRET_KEY=SAIPPUAKAUPPIAS
 *
 * ВАЖНО: для server-to-server callback сервер/прокси должен пропускать заголовки:
 * signature, checkout-*, иначе handleCallback увидит "missing_signature_header".
 */

const fs = require('fs');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const express = require('express');

class Config {
    static MERCHANT_ID = 375917;
    static SECRET_KEY = 'SAIPPUAKAUPPIAS';
    static PAYTRAIL_ENDPOINT = 'https://services.paytrail.com/payments';

    // Жёстко задать базовый URL (или оставить '' и собрать автоматически)
    static FORCE_BASE_URL = 'https://www.encanta.fi/payment';

    static YOUR_DOMAIN = 'www.encanta.fi';
    static APP_PATH = '/payment';

    static BACK_URL = 'https://encanta.fi/';

    static LOG_FILE = path.join(__dirname, 'paytrail.log');
    static DEBUG_LOGS = true;

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

class Logger {
    static event(event, data = {}) {
        if (!Config.DEBUG_LOGS) return;
        const copy = { ...data };
        delete copy.SECRET_KEY;
        const line = `[${new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')}] ${event} ` +
            JSON.stringify(copy, null, 0);
        try {
            fs.appendFileSync(Config.LOG_FILE, line + '\n');
        } catch (_) {}
    }
}

class Views {
    static e(s) {
        return String(s)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    static resultPage(action, data) {
        const title = action === 'success' ? 'Оплата успешно завершена' : 'Оплата отменена';
        const note = data.note || '';
        const tx = String(data.tx ?? '');
        const status = String(data.status ?? '');
        const provider = String(data.provider ?? '');
        const amount = data.amount;
        const reference = String(data.reference ?? '');
        const stamp = String(data.stamp ?? '');

        const amountStr = Number.isFinite(+amount)
            ? (Number(amount) / 100).toFixed(2) + ' €'
            : this.e(String(amount ?? ''));

        return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${this.e(title)}</title>
<style>
body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Ubuntu,Cantarell,Helvetica,Arial,sans-serif;line-height:1.45;padding:24px;background:#f7f7f8;color:#111}
.card{max-width:720px;margin:0 auto;background:#fff;border-radius:16px;padding:24px;box-shadow:0 8px 30px rgba(0,0,0,.06)}
h1{margin:0 0 8px;font-size:24px}
.ok{color:#0a7a2d}.warn{color:#a15c00}
.grid{display:grid;grid-template-columns:160px 1fr;gap:8px 12px;margin-top:12px}
.muted{color:#666}
.btn{display:inline-block;margin-top:18px;padding:12px 16px;border-radius:10px;text-decoration:none;border:1px solid #ddd}
.btn-primary{border-color:#222;color:#fff;background:#222}
.btn + .btn{margin-left:8px}
</style></head><body>
<div class="card">
  <h1>${this.e(title)}</h1>
  <div class="${action === 'success' ? 'ok' : 'warn'}">${this.e(note)}</div>
  <div class="grid">
    <div class="muted">Transaction ID</div><div>${this.e(tx)}</div>
    <div class="muted">Status</div><div>${this.e(status)}</div>
    <div class="muted">Provider</div><div>${this.e(provider)}</div>
    <div class="muted">Amount</div><div>${amountStr}</div>
    <div class="muted">Reference</div><div>${this.e(reference)}</div>
    <div class="muted">Stamp</div><div>${this.e(stamp)}</div>
  </div>
  <div>${
            action === 'success'
                ? `<a class="btn btn-primary" href="${this.e(Config.BACK_URL)}">← Назад в магазин</a>`
                : `<a class="btn" href="${this.e(Config.FORCE_BASE_URL || '')}">Попробовать оплатить снова</a>
         <a class="btn" href="${this.e(Config.BACK_URL)}">← Назад в магазин</a>`
        }</div>
</div></body></html>`;
    }
}

class PaytrailSystem {
    /**
     * Создаёт платёж в Paytrail и редиректит пользователя на страницу оплаты.
     */
    static async createAndRedirect(req, res) {
        const stamp = `order-${Math.floor(Date.now() / 1000)}`;

        const order = {
            reference: stamp, // Paytrail может изменить reference на числовой
            amount: 1590,
            items: [{
                unitPrice: 1590,
                units: 1,
                vatPercentage: 24,
                productCode: 'SKU-001',
                description: 'Test product',
                category: 'General'
            }],
            customer: {
                email: 'test@example.com',
                firstName: 'Test',
                lastName: 'User',
                phone: '+358501234567'
            }
        };

        const bodyObj = {
            stamp,
            reference: order.reference,
            amount: order.amount,
            currency: 'EUR',
            language: 'FI',
            items: order.items,
            customer: order.customer,
            redirectUrls: {
                success: Config.selfUrl(req, 'success'),
                cancel: Config.selfUrl(req, 'cancel')
            },
            callbackUrls: {
                success: Config.selfUrl(req, 'callback'),
                cancel: Config.selfUrl(req, 'callback')
            }
        };
        const body = JSON.stringify(bodyObj);

        // Заголовки для подписи запроса
        const headersForSign = {
            'checkout-account': String(Config.MERCHANT_ID),
            'checkout-algorithm': 'sha256',
            'checkout-method': 'POST',
            'checkout-nonce': crypto.randomBytes(16).toString('hex'),
            'checkout-timestamp': new Date().toISOString()
        };

        // "k:v\n..."+ "\n" + raw body
        const sortedEntries = Object.entries(headersForSign).sort(([a], [b]) => a.localeCompare(b));
        const stringToSign = sortedEntries.map(([k, v]) => `${k}:${v}`).join('\n') + '\n' + body;
        const signature = crypto.createHmac('sha256', Config.SECRET_KEY).update(stringToSign, 'utf8').digest('hex');

        const httpHeaders = {
            'Content-Type': 'application/json; charset=utf-8',
            ...headersForSign,
            'signature': signature
        };

        Logger.event('payment_create_request', {
            endpoint: Config.PAYTRAIL_ENDPOINT,
            headers: headersForSign,
            has_signature: true,
            body: bodyObj,
            redirectUrls: bodyObj.redirectUrls,
            callbackUrls: bodyObj.callbackUrls
        });

        // POST на Paytrail
        let resp, text;
        try {
            resp = await fetch(Config.PAYTRAIL_ENDPOINT, {
                method: 'POST',
                headers: httpHeaders,
                body
            });
            text = await resp.text();
        } catch (e) {
            Logger.event('payment_create_fetch_error', { error: String(e) });
            res.status(500).send('Fetch error: ' + Views.e(String(e)));
            return;
        }

        let json;
        try { json = JSON.parse(text); } catch { json = null; }

        const transactionId = json ? (json.transactionId ?? null) : null;

        Logger.event('payment_create_response', {
            http_code: resp.status,
            transactionId,
            stamp,
            body_raw: json ? null : text,
            body_json: json || null
        });

        if (resp.status !== 201) {
            res.status(resp.status).send('Paytrail error (' + resp.status + '): ' + Views.e(text));
            return;
        }

        const href = json.href ?? (json.providers && json.providers[0] && json.providers[0].url) ?? null;

        Logger.event('payment_redirect', { href });

        if (href) {
            res.redirect(href);
            return;
        }

        res.status(502).send('Нет ссылки на оплату (href) и нет доступных методов');
    }

    /**
     * Проверка подписи redirect (query checkout-* + пустая строка в конце).
     */
    static verifyRedirectSignature(query) {
        if (!query.signature) return false;

        const chk = {};
        for (const [k, v] of Object.entries(query)) {
            const lk = String(k).toLowerCase();
            if (lk.startsWith('checkout-')) chk[lk] = String(v);
        }
        const keys = Object.keys(chk);
        if (!keys.length) return false;

        keys.sort();
        const stringToSign = keys.map(k => `${k}:${chk[k]}`).join('\n') + '\n';
        const calc = crypto.createHmac('sha256', Config.SECRET_KEY).update(stringToSign, 'utf8').digest('hex');

        return crypto.timingSafeEqual(Buffer.from(calc), Buffer.from(String(query.signature).toLowerCase()));
    }

    /**
     * Рендерит success/cancel.
     */
    static renderSuccessOrCancel(req, res, action) {
        const ok = this.verifyRedirectSignature(req.query);
        const tx = req.query['checkout-transaction-id'] ?? null;
        const status = req.query['checkout-status'] ?? null;
        const provider = req.query['checkout-provider'] ?? null;
        const amount = req.query['checkout-amount'] ?? null;
        const stamp = req.query['checkout-stamp'] ?? null;       // 🔑 главный идентификатор
        const reference = req.query['checkout-reference'] ?? null;

        Logger.event('redirect_' + action, {
            url: req.originalUrl || '',
            signature_ok: ok,
            status,
            provider,
            amount,
            stamp,
            reference,
            tx
        });

        const note = action === 'success'
            ? (ok ? 'Подпись валидна. Спасибо за оплату!' : 'Внимание: подпись не подтверждена.')
            : (ok ? 'Подпись валидна, статус fail/отмена.' : 'Внимание: подпись не подтверждена.');

        res.set('Content-Type', 'text/html; charset=utf-8').send(
            Views.resultPage(action, {
                note,
                tx: String(tx ?? ''),
                status: String(status ?? ''),
                provider: String(provider ?? ''),
                amount,
                reference: String(reference ?? ''),
                stamp: String(stamp ?? '')
            })
        );
    }

    /**
     * Обработка server-to-server callback.
     * ВНИМАНИЕ: для корректной подписи нужен сырой body. В роутере ниже есть raw-миддлвар.
     */
    static handleCallback(req, res) {
        const SECRET = Config.SECRET_KEY;

        const mainLogFile = path.join(__dirname, 'paytrail.log');
        const warnLogFile = path.join(__dirname, 'paytrail_warn.log');
        const errorLogFile = path.join(__dirname, 'paytrail_error.log');
        const now = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');

        const writeLine = (file, event, payload) => {
            const line = `[${now}] ${event} ${JSON.stringify(payload, null, 0)}\n`;
            try { fs.appendFileSync(file, line); } catch (_) {}
        };

        const log = (payload) => {
            const status = payload.status || 'ok';
            writeLine(mainLogFile, 'callback_event', payload);
            if (status === 'warn') writeLine(warnLogFile, 'callback_event', payload);
            if (status === 'error') writeLine(errorLogFile, 'callback_event', payload);
        };

        // ---- Сбор заголовков (в нижнем регистре) ----
        const headers = {};
        for (const [k, v] of Object.entries(req.headers || {})) {
            headers[String(k).toLowerCase()] = v;
        }

        // ---- Контекст ----
        const method = (req.method || 'GET').toUpperCase();
        const uri = req.originalUrl || '';
        const remoteIp = req.ip || req.connection?.remoteAddress || '';
        const userAgent = req.get('user-agent') || '';
        const requestId = headers['request-id'] || headers['x-request-id'] || '';
        const rawBody = req.rawBody || ''; // см. middleware ниже
        const contentLen = Number(req.get('content-length') || 0);
        const query = req.query || {};

        const sigHead = headers['signature'] || null;
        const sigQuery = query.signature || null;

        // ---- Диагностика прокси/WAF ----
        const reasons = [];
        if (method !== 'POST') reasons.push('unexpected_method (expected POST)');
        if (!sigHead) reasons.push('missing_signature_header');
        if (!Object.keys(headers).some(k => k.startsWith('checkout-'))) reasons.push('missing_checkout_headers');
        if (rawBody === '' && method === 'POST' && contentLen === 0) reasons.push('empty_raw_body (raw)');
        if (sigQuery || Object.keys(query).some(k => String(k).startsWith('checkout-'))) reasons.push('callback_parameters_in_query');

        // ---- POST с подписью в заголовке (норма) ----
        if (method === 'POST' && sigHead) {
            // Canonical = значения ВСЕХ checkout-* заголовков (по алфавиту) + rawBody
            const canonHeaders = {};
            for (const [k, v] of Object.entries(headers)) {
                if (k.startsWith('checkout-')) canonHeaders[k] = Array.isArray(v) ? v.join(',') : String(v);
            }
            const keys = Object.keys(canonHeaders).sort();
            const canonical = keys.map(k => canonHeaders[k]).join('\n') + rawBody;

            const calc = crypto.createHmac('sha256', SECRET).update(canonical, 'utf8').digest('hex');
            const valid = safeEq(calc, String(sigHead).toLowerCase());

            if (valid) {
                let json = {};
                try { json = JSON.parse(rawBody || '{}') || {}; } catch { json = {}; }
                const tx = json.transactionId ?? json['checkout-transaction-id'] ?? '';
                const stamp = json.stamp ?? json['checkout-stamp'] ?? '';
                const amt = json.amount ?? json['checkout-amount'] ?? null;

                // Идемпотентная обработка:
                // if (!OrderRepository.alreadyHandled(stamp, tx)) {
                //   OrderRepository.markHandled(stamp, tx, (json.status || ''), Number(amt || 0));
                // }

                log({
                    status: reasons.length ? 'warn' : 'ok',
                    method: 'POST',
                    uri,
                    remote_ip: remoteIp,
                    user_agent: userAgent,
                    request_id: requestId,
                    msg: 'POST valid signature',
                    tx,
                    stamp,
                    amount: amt,
                    reasons: reasons.length ? reasons : null
                });

                res.status(200).send('OK');
                return;
            }

            log({
                status: 'error',
                method: 'POST',
                uri,
                remote_ip: remoteIp,
                user_agent: userAgent,
                request_id: requestId,
                reason: 'invalid signature',
                msg: 'Signature mismatch – HMAC validation failed',
                reasons: reasons.length ? reasons : null
            });
            res.status(400).send('ERR');
            return;
        }

        // ---- GET fallback (не норма, но поддерживаем) ----
        if (method === 'GET' && sigQuery) {
            const parts = {};
            for (const [k, v] of Object.entries(query)) {
                if (k === 'signature') continue;
                if (k.startsWith('checkout-')) parts[k] = String(v);
            }
            const keys = Object.keys(parts).sort();
            const canonical = keys.map(k => parts[k]).join('\n');
            const calc = crypto.createHmac('sha256', SECRET).update(canonical, 'utf8').digest('hex');
            const valid = safeEq(calc, String(sigQuery).toLowerCase());

            if (valid) {
                log({
                    status: 'warn',
                    method: 'GET',
                    uri,
                    remote_ip: remoteIp,
                    user_agent: userAgent,
                    request_id: requestId,
                    msg: 'Proxy/WAF suspected – using GET fallback',
                    reasons: Array.from(new Set([...reasons, 'using_get_fallback']))
                });
                res.status(200).send('OK');
                return;
            }

            log({
                status: 'error',
                method: 'GET',
                uri,
                remote_ip: remoteIp,
                user_agent: userAgent,
                request_id: requestId,
                reason: 'invalid signature',
                msg: 'GET signature check failed',
                reasons: reasons.length ? reasons : null
            });
            res.status(400).send('ERR');
            return;
        }

        // ---- Иное: неподдерживаемый формат / нет подписи ----
        log({
            status: 'error',
            method,
            uri,
            remote_ip: remoteIp,
            user_agent: userAgent,
            request_id: requestId,
            reason: 'unsupported method or missing signature',
            msg: 'Unexpected callback format',
            reasons: reasons.length ? reasons : null
        });
        res.status(405).send('Method Not Allowed');
    }
}

// Тайминг-сейф сравнение в hex
function safeEq(a, b) {
    try {
        const A = Buffer.from(String(a).toLowerCase());
        const B = Buffer.from(String(b).toLowerCase());
        if (A.length !== B.length) return false;
        return crypto.timingSafeEqual(A, B);
    } catch {
        return false;
    }
}

// =========================
/*          5) APP        */
// =========================
const app = express();

// Обычные JSON/URL-encoded для "create" и redirect-страниц
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

// Роут для callback ДОЛЖЕН получить сырой body -> отдельный raw middleware ниже
// Мы не ставим raw глобально, чтобы не мешать остальным роутам.

// Главная точка входа (как index.php?action=...)
app.get(['/index', '/'], async (req, res) => {
    const action = String(req.query.action || 'create');

    try {
        switch (action) {
            case 'success':
                return PaytrailSystem.renderSuccessOrCancel(req, res, 'success');
            case 'cancel':
                return PaytrailSystem.renderSuccessOrCancel(req, res, 'cancel');
            case 'callback':
                // Если Paytrail вдруг сделает GET на callback — обработаем GET-фоллбек
                return PaytrailSystem.handleCallback(req, res);
            case 'create':
            default:
                return PaytrailSystem.createAndRedirect(req, res);
        }
    } catch (e) {
        Logger.event('app_error', { action, error: String(e) });
        res.status(500).send('Internal error');
    }
});

// POST callback с raw JSON (для подписи нужен сырой body)
app.post(['/index', '/'], express.raw({ type: 'application/json' }), (req, res, next) => {
    // Сохраняем сырой body как строку в req.rawBody и парсим JSON при необходимости
    try {
        req.rawBody = req.body ? req.body.toString('utf8') : '';
    } catch {
        req.rawBody = '';
    }
    // Чтобы не мешать существующим JSON-обработчикам, НЕ переприсваиваем req.body здесь.
    // Логику целиком замыкаем в PaytrailSystem.handleCallback (он использует rawBody).
    const action = String(req.query.action || '');
    if (action === 'callback') {
        return PaytrailSystem.handleCallback(req, res);
    }
    return next();
});

// Fallback на 404
app.use((req, res) => {
    res.status(404).send('Not Found');
});

// Запуск
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    Logger.event('server_started', { port: PORT });
    console.log(`Server listening on http://localhost:${PORT}`);
});
