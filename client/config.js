// config.js
require('dotenv').config();
const os = require('os');

const config = {
    serverUrl: process.env.WS_SERVER_URL,
    clientToken: process.env.CLIENT_TOKEN,
    clientHostname: os.hostname(),
    heartbeatInterval: parseInt(process.env.HEARTBEAT_INTERVAL, 10) || 30 * 1000,
    initialReconnectInterval: parseInt(process.env.INITIAL_RECONNECT_INTERVAL, 10) || 5 * 1000,
    maxReconnectInterval: parseInt(process.env.MAX_RECONNECT_INTERVAL, 10) || 60 * 1000,
};

// 必須設定のチェック
if (!config.clientToken) {
    console.error('[Configエラー] CLIENT_TOKEN が .env ファイルまたは環境変数で設定されていません。');
    process.exit(1);
}
if (!config.serverUrl) {
    console.error('[Configエラー] WS_SERVER_URL が .env ファイルまたは環境変数で設定されていません。');
    process.exit(1);
}
if (!config.serverUrl.startsWith('ws://') && !config.serverUrl.startsWith('wss://')) {
    console.error('[Configエラー] WS_SERVER_URL は "ws://" または "wss://" で始まる必要があります。');
    process.exit(1);
}

module.exports = config;