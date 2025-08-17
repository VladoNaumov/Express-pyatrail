'use strict';

const fs = require('fs');
const Config = require('./Config');

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

module.exports = Logger;
