const fs = require('fs');
const path = require('path');
const LOG_FILE = path.join(process.cwd(), 'paytrail.log');

// Пишем строку JSON в лог (UTC ISO8601). Никогда не логируем SECRET_KEY.
function event(name, data = {}) {
    const safe = { ...data };
    delete safe.SECRET_KEY;
    const line = `[${new Date().toISOString()}] ${name} ${JSON.stringify(safe)}`;
    fs.appendFile(LOG_FILE, line + '\n', () => {});
}

module.exports = { event };
