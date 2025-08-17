'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const Config = require('./Config');

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

function nowIso() {
    return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
}

// Пишем в несколько файлов по статусу
function writeMultiLogs(event, payload) {
    const now = nowIso();
    const main = path.join(__dirname, '..', 'paytrail.log');
    const warn = path.join(__dirname, '..', 'paytrail_warn.log');
    const err  = path.join(__dirname, '..', 'paytrail_error.log');

    const line = `[${now}] ${event} ${JSON.stringify(payload, null, 0)}\n`;
    try { fs.appendFileSync(main, line); } catch (_) {}

    if (payload.status === 'warn') {
        try { fs.appendFileSync(warn, line); } catch (_) {}
    }
    if (payload.status === 'error') {
        try { fs.appendFileSync(err, line); } catch (_) {}
    }
}

module.exports = { safeEq, nowIso, writeMultiLogs };
