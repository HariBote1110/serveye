// messageHandlers.js
const { getSystemInfo } = require('./systemInfoCollector');
const WebSocket = require('ws'); // WebSocket.OPEN の比較のため

/**
 * サーバーから受信したメッセージを処理します。
 * @param {WebSocket} ws - WebSocketインスタンス。
 * @param {string} messageString - 受信したメッセージ（JSON文字列）。
 * @param {object} config - クライアント設定オブジェクト。
 * @param {object} cpuMonitor - CPU監視モジュール。
 * @param {object} memoryMonitor - メモリ監視モジュール (getMemoryUsageHistory, MEMORY_SAMPLE_INTERVAL_MS を持つ)。
 */
function handleMessage(ws, messageString, config, cpuMonitor, memoryMonitor) {
    let message;
    try {
        message = JSON.parse(messageString);
    } catch (e) {
        console.error('[MessageHandler] 受信メッセージのJSON解析に失敗:', e, messageString.substring(0,100));
        return; // 解析できないメッセージは処理しない
    }

    // console.log(`[MessageHandler] サーバーからメッセージ受信: Type: ${message.type}, RequestID: ${message.requestId || 'N/A'}`); // デバッグ用

    switch (message.type) {
        case 'auth_success':
            console.log(`[MessageHandler] サーバー認証成功。クライアント名 (サーバー割当): ${message.clientId}`);
            // auth_success に関するクライアント側の具体的なアクションは client.js や websocketManager.js で処理
            break;
        case 'auth_failed':
            console.error(`[MessageHandler] サーバー認証失敗: ${message.message}`);
            console.error('[重要] .env ファイルの CLIENT_TOKEN を確認してください。');
            // websocketManager が onclose をトリガーし、再接続しないようにする
            ws.close(1008, 'Authentication failed by server');
            break;
        case 'request_system_info': // `/systeminfo` コマンドからのリクエスト
            console.log(`[MessageHandler] システム情報要求受信 (Request ID: ${message.requestId})`);
            getSystemInfo()
                .then(systemInfo => {
                    if (ws.readyState === WebSocket.OPEN) {
                        ws.send(JSON.stringify({
                            type: 'system_info_response',
                            requestId: message.requestId,
                            data: systemInfo
                        }));
                        // console.log('[MessageHandler] システム情報をサーバーに送信しました。');
                    } else {
                        console.warn('[MessageHandler] システム情報送信試行時、WebSocketは既に閉じていました (ReqID:', message.requestId, ')');
                    }
                })
                .catch(error => {
                    console.error('[MessageHandler] システム情報取得/送信エラー (ReqID:', message.requestId, '):', error);
                    if (ws.readyState === WebSocket.OPEN) {
                        ws.send(JSON.stringify({
                            type: 'system_info_response',
                            requestId: message.requestId,
                            error: error.message || 'クライアント側でシステム情報の取得に失敗しました。'
                        }));
                    }
                });
            break;
        case 'request_cpu_history': // `/cpuhistory` コマンドからのリクエスト
            console.log(`[MessageHandler] CPU使用率履歴リクエスト受信 (ReqID: ${message.requestId})`);
            if (cpuMonitor && typeof cpuMonitor.getCpuUsageHistory === 'function') {
                const history = cpuMonitor.getCpuUsageHistory();
                const intervalMs = cpuMonitor.CPU_SAMPLE_INTERVAL_MS; // cpuMonitorから取得
                // const historyLength = cpuMonitor.CPU_HISTORY_LENGTH; // 参考情報

                if (ws.readyState === WebSocket.OPEN) {
                    ws.send(JSON.stringify({
                        type: 'cpu_history_response',
                        requestId: message.requestId,
                        data: {
                            samples: history,
                            intervalMs: intervalMs,
                            // durationSeconds はクライアントが保持しているサンプル数と間隔から計算
                            durationSeconds: Math.floor(history.length * intervalMs / 1000)
                        }
                    }));
                    // console.log('[MessageHandler] 保持しているCPU使用率履歴をサーバーに送信しました。', history.length, 'サンプル');
                } else {
                     console.warn('[MessageHandler] CPU履歴送信試行時、WebSocketは既に閉じていました (ReqID:', message.requestId, ')');
                }
            } else {
                console.error('[MessageHandler] cpuMonitorが正しく渡されていないか、getCpuUsageHistory関数がありません。CPU履歴を送信できません。');
                if (ws.readyState === WebSocket.OPEN) {
                     ws.send(JSON.stringify({
                        type: 'cpu_history_response',
                        requestId: message.requestId,
                        error: 'クライアント側でCPU監視モジュールが利用できないか、履歴がありません。'
                    }));
                }
            }
            break;
                    case 'request_memory_history': // ★ `/memoryhistory` コマンドからのリクエスト
            console.log(`[MessageHandler] メモリ使用率履歴リクエスト受信 (ReqID: ${message.requestId})`);
            if (memoryMonitor && typeof memoryMonitor.getMemoryUsageHistory === 'function') {
                const history = memoryMonitor.getMemoryUsageHistory();
                const intervalMs = memoryMonitor.MEMORY_SAMPLE_INTERVAL_MS;

                if (ws.readyState === WebSocket.OPEN) {
                    ws.send(JSON.stringify({
                        type: 'memory_history_response', // ★応答タイプ
                        requestId: message.requestId,
                        data: {
                            samples: history,
                            intervalMs: intervalMs,
                            durationSeconds: Math.floor(history.length * intervalMs / 1000)
                        }
                    }));
                    // console.log('[MessageHandler] 保持しているメモリ使用率履歴をサーバーに送信しました。', history.length, 'サンプル');
                } else {
                    console.warn('[MessageHandler] メモリ履歴送信試行時、WebSocketは既に閉じていました (ReqID:', message.requestId, ')');
                }
            } else {
                console.error('[MessageHandler] memoryMonitorが正しく渡されていないか、getMemoryUsageHistory関数がありません。メモリ履歴を送信できません。');
                if (ws.readyState === WebSocket.OPEN) {
                    ws.send(JSON.stringify({
                        type: 'memory_history_response',
                        requestId: message.requestId,
                        error: 'クライアント側でメモリ監視モジュールが利用できないか、履歴がありません。'
                    }));
                }
            }
            break;

        // 'heartbeat_ack' は client.js の onMessage で直接処理されるため、ここでは case 不要
        // case 'heartbeat_ack':
        //     break;
        case 'error': // サーバーから明示的なエラーメッセージが送られてきた場合
            console.error(`[MessageHandler] サーバーからエラー通知: ${message.message}`);
            break;
        default:
            console.log(`[MessageHandler] 未対応のメッセージタイプを受信: ${message.type}`, message.data || '');
    }
}

module.exports = { handleMessage };