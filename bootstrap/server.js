const http = require('http');
const app = require('../app');
const config = require('../config/server');

function createServer() {
    const server = http.createServer(app);

    server.listen(config.port, () => {
        console.log(`🚀 Server running at http://${config.host}:${config.port}`);
    });

    server.on('error', (err) => {
        if (err.code === 'EACCES') {
            console.error(`Port ${config.port} requires elevated privileges`);
            process.exit(1);
        }
        if (err.code === 'EADDRINUSE') {
            console.error(`Port ${config.port} is already in use`);
            process.exit(1);
        }
        console.error(err);
        process.exit(1);
    });

    return server;
}

module.exports = createServer;
