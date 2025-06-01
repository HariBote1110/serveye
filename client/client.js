// client.js
const config = require('./config');
const wsManager = require('./websocketManager');
const { handleMessage } = require('./messageHandlers');
const cpuMonitor = require('./cpuMonitor');
const memoryMonitor = require('./memoryMonitor'); // ★ memoryMonitor モジュールをインポート
const WebSocket = require('ws');

console.log(`[情報] クライアント実ホスト名: ${config.clientHostname}`);
console.log(`[情報] ターゲットWebSocketサーバー: ${config.serverUrl ? config.serverUrl.split('?')[0] : '(未設定)'}`);
console.log(`[情報] 使用トークン: ${config.clientToken ? config.clientToken.substring(0,8) + '...' : '(未設定!)'}`);
console.log(`[情報] ハートビート間隔: ${config.heartbeatInterval / 1000}秒`);
console.log(`[情報] CPU監視 間隔: ${cpuMonitor.CPU_SAMPLE_INTERVAL_MS / 1000}秒, 保持サンプル数: ${cpuMonitor.CPU_HISTORY_LENGTH}`);


let heartbeatIntervalId = null;
let serverAcknowledgedHeartbeat = true;

// WebSocket接続成功時の処理
function onOpen(ws) { // wsManagerからwsインスタンスが渡される
    console.log('[ClientMain] WebSocket接続成功 (onOpen呼び出し)');
    serverAcknowledgedHeartbeat = true; // 接続時にリセット

    // 初期情報を送信
    const initialInfo = {
        type: 'initial_info',
        data: {
            actualHost: config.clientHostname,
        }
    };
    if (wsManager.sendMessage(initialInfo)) { // wsManager経由で送信
        console.log('[ClientMain] 初期情報送信:', initialInfo.data);
    } else {
        console.warn('[ClientMain] 初期情報送信失敗: WebSocket未接続');
    }


    // ハートビートを開始
    if (heartbeatIntervalId) clearInterval(heartbeatIntervalId);
    heartbeatIntervalId = setInterval(() => {
        const currentWs = wsManager.getWsInstance(); // 最新のwsインスタンスを取得
        if (currentWs && currentWs.readyState === WebSocket.OPEN) {
            if (!serverAcknowledgedHeartbeat) {
                console.warn('[ClientMain] サーバーからのハートビート応答がありません。接続を強制終了し再接続を試みます。');
                wsManager.terminateConnection(); // wsManager経由で終了 -> 再接続がスケジュールされる
                return;
            }
            serverAcknowledgedHeartbeat = false;
            wsManager.sendMessage({ type: 'heartbeat', timestamp: Date.now() });
            // console.log('[ClientMain] ハートビート送信'); // デバッグ用
        } else if (!currentWs || currentWs.readyState !== WebSocket.OPEN) {
            // console.warn('[ClientMain] ハートビート送信試行時、WebSocket未接続または接続中ではありません。');
        }
    }, config.heartbeatInterval);
}

// メッセージ受信時の処理
function onMessage(ws, messageString) { // wsManagerからwsインスタンスとメッセージ文字列が渡される
    let message;
    try {
        message = JSON.parse(messageString);
    } catch(e) {
        console.error('[ClientMain] 受信メッセージのJSON解析に失敗 (onMessage):', e);
        return;
    }

    if (message.type === 'heartbeat_ack') {
        // console.log('[ClientMain] ハートビート応答受信。'); // デバッグ用
        serverAcknowledgedHeartbeat = true;
    } else {
        // 他のメッセージは汎用ハンドラへ。wsインスタンスとconfig、cpuMonitorも渡す
        handleMessage(ws, messageString, config, cpuMonitor, memoryMonitor); // ★ memoryMonitor を追加
    }
}

// WebSocket切断時の処理
function onClose(_event) { // eventオブジェクトはここでは未使用
    console.warn(`[ClientMain] WebSocket接続が閉じられました。再接続はwebsocketManagerが行います。`);
    if (heartbeatIntervalId) clearInterval(heartbeatIntervalId);
    heartbeatIntervalId = null;
    serverAcknowledgedHeartbeat = true; // 再接続に備えてリセット

    // CPU監視を停止するかどうかはポリシーによる
    // 接続が切れてもローカルで監視を続けるなら stopCpuMonitoring() は呼ばない
    // cpuMonitor.stopCpuMonitoring();
    // console.log('[ClientMain] (接続断のためCPU監視を一時停止しました - 必要ならコメント解除)');
}

// --- メイン処理開始 ---

// CPU監視を開始 (WebSocket接続状態に関わらず開始する場合)
cpuMonitor.startCpuMonitoring();
memoryMonitor.startMemoryMonitoring(); // ★ メモリ監視を開始

// WebSocket接続を開始
wsManager.connectToServer(config, onOpen, onMessage, onClose);


// --- Graceful Shutdown ---
function gracefulShutdown(signal) {
    console.log(`[情報] ${signal} を受信。クリーンアップ処理を開始...`);

    // CPU監視を停止
    cpuMonitor.stopCpuMonitoring();
    memoryMonitor.stopMemoryMonitoring(); // ★ メモリ監視を停止

    if (heartbeatIntervalId) clearInterval(heartbeatIntervalId);

    const currentWs = wsManager.getWsInstance();
    if (currentWs && currentWs.readyState === WebSocket.OPEN) {
        console.log('[ClientMain] サーバーに接続を閉じることを通知します...');
        currentWs.close(1000, 'Client shutting down gracefully'); // 1000: Normal Closure
    }

    // 少し待ってからプロセスを終了 (WebSocketのclose処理が完了するのを期待)
    setTimeout(() => {
        console.log('[情報] プログラムを終了します。');
        process.exit(0);
    }, 1500); // 1.5秒待つ
}

process.on('SIGINT', () => gracefulShutdown('SIGINT')); // Ctrl+C
process.on('SIGTERM', () => gracefulShutdown('SIGTERM')); // kill コマンド
process.on('SIGQUIT', () => gracefulShutdown('SIGQUIT')); // Ctrl+\