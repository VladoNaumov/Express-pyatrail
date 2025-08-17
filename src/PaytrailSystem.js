'use strict';

const crypto = require('crypto');

const Config = require('./Config');
const Logger = require('./Logger');
const Views = require('./Views');
const { safeEq, nowIso, writeMultiLogs } = require('./utils');

class PaytrailSystem {
    static async createAndRedirect(req, res) {
        const stamp = `order-${Math.floor(Date.now() / 1000)}`;

        const order = {
            reference: stamp,
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

        const headersForSign = {
            'checkout-account': String(Config.MERCHANT_ID),
            'checkout-algorithm': 'sha256',
            'checkout-method': 'POST',
            'checkout-nonce': crypto.randomBytes(16).toString('hex'),
            'checkout-timestamp': new Date().toISOString()
        };

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

        let resp, text, json;
        try {
            resp = await fetch(Config.PAYTRAIL_ENDPOINT, {
                method: 'POST',
                headers: httpHeaders,
                body
            });
            text = await resp.text();
            try { json = JSON.parse(text); } catch { json = null; }
        } catch (e) {
            Logger.event('payment_create_fetch_error', { error: String(e) });
            return res.status(500).render('error', { title: 'Fetch error', message: String(e) });
        }

        const transactionId = json ? (json.transactionId ?? null) : null;

        Logger.event('payment_create_response', {
            http_code: resp.status,
            transactionId,
            stamp,
            body_raw: json ? null : text,
            body_json: json || null
        });

        if (resp.status !== 201) {
            return res.status(resp.status).render('error', {
                title: `Paytrail error (${resp.status})`,
                message: text
            });
        }

        const href = json?.href ?? (json?.providers?.[0]?.url) ?? null;
        Logger.event('payment_redirect', { href });

        if (href) return res.redirect(href);

        return res.status(502).render('error', {
            title: 'Нет ссылки на оплату',
            message: 'Нет href и нет доступных методов'
        });
    }

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

        try {
            return crypto.timingSafeEqual(Buffer.from(calc), Buffer.from(String(query.signature).toLowerCase()));
        } catch {
            return false;
        }
    }

    static renderSuccessOrCancel(req, res, action) {
        const ok = this.verifyRedirectSignature(req.query);
        const tx = req.query['checkout-transaction-id'] ?? '';
        const status = req.query['checkout-status'] ?? '';
        const provider = req.query['checkout-provider'] ?? '';
        const amount = req.query['checkout-amount'] ?? '';
        const stamp = req.query['checkout-stamp'] ?? '';
        const reference = req.query['checkout-reference'] ?? '';

        Logger.event('redirect_' + action, {
            url: req.originalUrl || '',
            signature_ok: ok,
            status, provider, amount, stamp, reference, tx
        });

        const note = action === 'success'
            ? (ok ? 'Подпись валидна. Спасибо за оплату!' : 'Внимание: подпись не подтверждена.')
            : (ok ? 'Подпись валидна, статус fail/отмена.' : 'Внимание: подпись не подтверждена.');

        return Views.renderResult(res, action, {
            note,
            tx: String(tx || ''),
            status: String(status || ''),
            provider: String(provider || ''),
            amount,
            reference: String(reference || ''),
            stamp: String(stamp || ''),
            backUrl: Config.BACK_URL,
            retryUrl: Config.FORCE_BASE_URL || ''
        });
    }

    static handleCallback(req, res) {
        const SECRET = Config.SECRET_KEY;

        const now = nowIso();
        const { headers, method, uri, remoteIp, userAgent, requestId, rawBody, contentLen, query } = this._collectContext(req);

        const sigHead = headers['signature'] || null;
        const sigQuery = query.signature || null;

        const reasons = [];
        if (method !== 'POST') reasons.push('unexpected_method (expected POST)');
        if (!sigHead) reasons.push('missing_signature_header');
        if (!Object.keys(headers).some(k => k.startsWith('checkout-'))) reasons.push('missing_checkout_headers');
        if (rawBody === '' && method === 'POST' && contentLen === 0) reasons.push('empty_raw_body (raw)');
        if (sigQuery || Object.keys(query).some(k => String(k).startsWith('checkout-'))) reasons.push('callback_parameters_in_query');

        // Норма: POST + подпись в заголовке
        if (method === 'POST' && sigHead) {
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

                writeMultiLogs('callback_event', {
                    status: reasons.length ? 'warn' : 'ok',
                    method: 'POST',
                    uri, remote_ip: remoteIp, user_agent: userAgent, request_id: requestId,
                    msg: 'POST valid signature',
                    tx, stamp, amount: amt,
                    reasons: reasons.length ? reasons : null
                });

                res.status(200).send('OK');
                return;
            }

            writeMultiLogs('callback_event', {
                status: 'error',
                method: 'POST',
                uri, remote_ip: remoteIp, user_agent: userAgent, request_id: requestId,
                reason: 'invalid signature',
                msg: 'Signature mismatch – HMAC validation failed',
                reasons: reasons.length ? reasons : null
            });
            res.status(400).send('ERR');
            return;
        }

        // Фоллбек GET
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
                writeMultiLogs('callback_event', {
                    status: 'warn',
                    method: 'GET',
                    uri, remote_ip: remoteIp, user_agent: userAgent, request_id: requestId,
                    msg: 'Proxy/WAF suspected – using GET fallback',
                    reasons: Array.from(new Set([...reasons, 'using_get_fallback']))
                });
                res.status(200).send('OK');
                return;
            }

            writeMultiLogs('callback_event', {
                status: 'error',
                method: 'GET',
                uri, remote_ip: remoteIp, user_agent: userAgent, request_id: requestId,
                reason: 'invalid signature',
                msg: 'GET signature check failed',
                reasons: reasons.length ? reasons : null
            });
            res.status(400).send('ERR');
            return;
        }

        // Иное
        writeMultiLogs('callback_event', {
            status: 'error',
            method, uri, remote_ip: remoteIp, user_agent: userAgent, request_id: requestId,
            reason: 'unsupported method or missing signature',
            msg: 'Unexpected callback format',
            reasons: reasons.length ? reasons : null
        });
        res.status(405).send('Method Not Allowed');
    }

    static _collectContext(req) {
        const headers = {};
        for (const [k, v] of Object.entries(req.headers || {})) {
            headers[String(k).toLowerCase()] = v;
        }
        return {
            headers,
            method: (req.method || 'GET').toUpperCase(),
            uri: req.originalUrl || '',
            remoteIp: req.ip || req.connection?.remoteAddress || '',
            userAgent: req.get('user-agent') || '',
            requestId: headers['request-id'] || headers['x-request-id'] || '',
            rawBody: req.rawBody || '',
            contentLen: Number(req.get('content-length') || 0),
            query: req.query || {}
        };
    }
}

module.exports = PaytrailSystem;
