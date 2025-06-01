// websocketHandler.js
const WebSocket = require('ws');
const { EmbedBuilder } = require('discord.js'); // Embed作成のため (主に通知用)

// 切断されたクライアントの通知タイマーを管理
const disconnectedClientTimers = new Map(); // Key: clientId, Value: { timerId, disconnectedAt, clientInfo }
const CRASH_NOTIFICATION_DELAY = 10 * 1000; // 10秒

function initializeWebSocketServer(
    httpServer,
    discordClient,    // Discord Client インスタンス (カスタムイベント発行用)
    connectedClients, // key: ws, value: clientRuntimeInfo
    generatedTokens,  // key: tokenString, value: tokenData (永続情報)
    port,
    discordLogChannelId,
    saveTokensToFileFunc,
    heartbeatInterval // index.js から渡されるハートビート間隔
) {
    console.log(`[WebSocketHandler] 初期化。受け取った heartbeatInterval: ${heartbeatInterval}ms`);
    if (typeof heartbeatInterval !== 'number' || heartbeatInterval <= 5000) {
        console.warn(`[WebSocketHandler Warn] heartbeatIntervalが非常に短いか無効です: ${heartbeatInterval}ms。デフォルトの30000msで動作します。`);
        heartbeatInterval = 30000; // フォールバック
    }

    let wss;
    if (httpServer) {
        wss = new WebSocket.Server({ server: httpServer });
    } else if (port) {
        wss = new WebSocket.Server({ port: port });
    } else {
        throw new Error('[WebSocketHandler] WebSocketサーバーの起動には httpServer または port が必要です。');
    }
    console.log(`[WebSocketHandler] WebSocketサーバー準備完了。`);

    wss.on('connection', (ws, req) => {
        const requestUrl = req.url || '';
        const urlParams = new URLSearchParams(requestUrl.substring(requestUrl.indexOf('?')));
        const token = urlParams.get('token');
        const clientIp = req.socket.remoteAddress; // 内部的なログや識別にのみ使用

        if (token && generatedTokens.has(token)) {
            const tokenData = generatedTokens.get(token); // 永続情報を取得
            const clientId = tokenData.clientId; // トークン発行時の名前

            let isTokenAlreadyInUse = false;
            for (const [clientWsInstance, activeClientData] of connectedClients.entries()) {
                if (clientWsInstance !== ws && activeClientData.token === token && clientWsInstance.readyState === WebSocket.OPEN) {
                    isTokenAlreadyInUse = true;
                    break;
                }
            }
            if (isTokenAlreadyInUse) {
                console.warn(`[WebSocket] トークン ${token.substring(0,8)}... は他のアクティブ接続で使用中のため、${clientId} [${clientIp}] の接続を拒否。`);
                ws.send(JSON.stringify({ type: 'auth_failed', message: 'Token already in use by another active client.' }));
                ws.close(1008, 'Token already in use');
                return;
            }

            console.log(`[WebSocket] クライアント ${clientId} (IP: ${clientIp}) が認証成功。`);
            ws.clientId = clientId;
            ws.token = token;

            const clientRuntimeInfo = {
                id: clientId,
                actualHost: tokenData.actualHost || 'N/A',
                ip: clientIp, // 内部的な情報として保持
                token: token,
                lastSeen: Date.now(),
                connectedAt: Date.now(),
                wsInstance: ws
            };
            connectedClients.set(ws, clientRuntimeInfo);

            // 永続情報のステータス更新
            tokenData.status = 'online';
            tokenData.lastSeen = Date.now();
            // tokenData.connectedIp = clientIp; // 表示しないので保存は任意
            tokenData.used = true;
            if (saveTokensToFileFunc) saveTokensToFileFunc();

            if (disconnectedClientTimers.has(clientId)) {
                const existingTimerData = disconnectedClientTimers.get(clientId);
                clearTimeout(existingTimerData.timerId);
                disconnectedClientTimers.delete(clientId);
                console.log(`[WebSocket] クライアント ${clientId} が再接続。クラッシュ/切断通知はキャンセル。`);
                if (discordLogChannelId) {
                    const channel = discordClient.channels.cache.get(discordLogChannelId);
                    if (channel && channel.isTextBased()) {
                        const embed = new EmbedBuilder()
                            .setTitle(`✅ クライアント復帰: ${clientId}`)
                            .setColor(0x00FF00) // Green
                            .setDescription(`クライアント \`${clientId}\` がネットワークに復帰しました。`)
                            .setTimestamp();
                        channel.send({ embeds: [embed] }).catch(console.error);
                    }
                }
            }

            ws.send(JSON.stringify({ type: 'auth_success', clientId: clientId, message: 'WebSocketサーバーへようこそ！' }));

            ws.on('message', (message) => {
                let parsedMessage;
                try {
                    parsedMessage = JSON.parse(message.toString());
                } catch (e) {
                    console.error('[WebSocket] 受信メッセージ解析失敗:', e, message.toString().substring(0, 100));
                    ws.send(JSON.stringify({ type: 'error', message: 'Invalid message format.' }));
                    return;
                }

                const currentClientRuntimeInfo = connectedClients.get(ws);
                if (!currentClientRuntimeInfo) {
                    console.warn(`[WebSocket] メッセージ受信: connectedClients に情報なし (ID: ${ws.clientId})。`);
                    return;
                }

                const currentTokenData = generatedTokens.get(ws.token);
                if (!currentTokenData) {
                     console.error(`[WebSocket] メッセージ受信: generatedTokens に情報なし (Token: ${ws.token})。`);
                    return;
                }

                const now = Date.now();
                currentTokenData.lastSeen = now;
                currentClientRuntimeInfo.lastSeen = now;
                // console.log(`[WebSocket Debug] Client ${currentClientRuntimeInfo.id} lastSeen updated to ${now} on msg type: ${parsedMessage.type}`);

                switch (parsedMessage.type) {
                    case 'initial_info':
                        if (parsedMessage.data && parsedMessage.data.actualHost) {
                            currentClientRuntimeInfo.actualHost = parsedMessage.data.actualHost;
                            currentTokenData.actualHost = parsedMessage.data.actualHost;
                            console.log(`[WebSocket] ${currentClientRuntimeInfo.id} 実ホスト名設定: ${currentClientRuntimeInfo.actualHost}`);
                            if (saveTokensToFileFunc) saveTokensToFileFunc();
                        }
                        break;
                    case 'heartbeat':
                        ws.send(JSON.stringify({ type: 'heartbeat_ack', timestamp: Date.now() }));
                        // lastSeen は全てのメッセージ受信時に更新されるので、ここではACK送信のみ
                        break;
                    case 'system_info_response': // クライアントからのシステム情報応答
                        if (parsedMessage.requestId) {
                            console.log(`[WebSocket] クライアント ${currentClientRuntimeInfo.id} からシステム情報応答受信 (Request ID: ${parsedMessage.requestId})`);
                            // Discordクライアントのカスタムイベントを発行してコマンドに応答を渡す
                            discordClient.emit(`systemInfoResponse_${parsedMessage.requestId}`, {
                                data: parsedMessage.data,
                                error: parsedMessage.error
                            });
                        } else {
                            console.warn(`[WebSocket] クライアント ${currentClientRuntimeInfo.id} からの system_info_response に requestId がありません。`);
                        }
                        break;
                    case 'cpu_history_response':
                        if (parsedMessage.requestId) {
                            console.log(`[WebSocket] クライアント ${currentClientRuntimeInfo.id} からCPU履歴応答受信 (Request ID: ${parsedMessage.requestId})`);
                            discordClient.emit(`cpuHistoryResponse_${parsedMessage.requestId}`, {
                                data: parsedMessage.data,
                                error: parsedMessage.error
                            });
                        } else {
                            console.warn(`[WebSocket] クライアント ${currentClientRuntimeInfo.id} からの cpu_history_response に requestId がありません。`);
                        }
                        break;
                    case 'memory_history_response': // ★新しい応答タイプ
                        if (parsedMessage.requestId) {
                            console.log(`[WebSocket] クライアント ${currentClientRuntimeInfo.id} からメモリ履歴応答受信 (Request ID: ${parsedMessage.requestId})`);
                            discordClient.emit(`memoryHistoryResponse_${parsedMessage.requestId}`, { // ★対応するイベントを発行
                                data: parsedMessage.data,
                                error: parsedMessage.error
                            });
                        } else {
                            console.warn(`[WebSocket] クライアント ${currentClientRuntimeInfo.id} からの memory_history_response に requestId がありません。`);
                        }
                        break; 
                    default:
                        console.warn(`[WebSocket] ${ws.clientId} から未対応メッセージタイプ: ${parsedMessage.type}`);
                }
                connectedClients.set(ws, currentClientRuntimeInfo);
            });

            ws.on('close', (code, reason) => {
                const reasonStr = reason instanceof Buffer ? reason.toString() : String(reason);
                const clientRuntimeData = connectedClients.get(ws);

                if (clientRuntimeData) {
                    const disconnectedClientId = clientRuntimeData.id;
                    console.log(`[WebSocket] クライアント ${disconnectedClientId} (IP: ${clientRuntimeData.ip}) が切断。Code: ${code}, Reason: ${reasonStr}`);

                    const tokenForClient = clientRuntimeData.token;
                    const clientTokenData = generatedTokens.get(tokenForClient);

                    if (clientTokenData) {
                        clientTokenData.status = 'offline';
                        clientTokenData.lastSeen = Date.now(); // 切断時刻を最終確認時刻
                        if (saveTokensToFileFunc) saveTokensToFileFunc();
                    }

                    if (!disconnectedClientTimers.has(disconnectedClientId)) {
                        const disconnectedClientInfoCopy = {
                            id: clientTokenData ? clientTokenData.clientId : disconnectedClientId,
                            actualHost: clientTokenData ? clientTokenData.actualHost : '不明',
                            lastSeen: clientTokenData ? clientTokenData.lastSeen : clientRuntimeData.lastSeen,
                            // connectedIp は表示しないので通知メッセージには含めない
                        };

                        const timerId = setTimeout(() => {
                            if (disconnectedClientTimers.has(disconnectedClientId)) {
                                console.log(`[WebSocket] クライアント ${disconnectedClientId} は ${CRASH_NOTIFICATION_DELAY / 1000}秒以内に再接続せず。クラッシュ/切断通知。`);
                                if (discordLogChannelId) {
                                    const channel = discordClient.channels.cache.get(discordLogChannelId);
                                    if (channel && channel.isTextBased()) {
                                        const embed = new EmbedBuilder()
                                            .setTitle(`🚨 クライアント長期切断: ${disconnectedClientId}`)
                                            .setColor(0xFF0000) // Red
                                            .setDescription(`クライアント \`${disconnectedClientId}\` (実ホスト: \`${disconnectedClientInfoCopy.actualHost || '不明'}\`) との接続が指定時間内に復旧しませんでした。`)
                                            .addFields({ name: '最終確認時刻', value: formatTimeAgo(disconnectedClientInfoCopy.lastSeen) })
                                            .setTimestamp(disconnectedClientInfoCopy.lastSeen);
                                        channel.send({ embeds: [embed] }).catch(console.error);
                                    }
                                }
                                disconnectedClientTimers.delete(disconnectedClientId);
                            }
                        }, CRASH_NOTIFICATION_DELAY);
                        disconnectedClientTimers.set(disconnectedClientId, { timerId, disconnectedAt: Date.now(), clientInfo: disconnectedClientInfoCopy });
                        console.log(`[WebSocket] ${disconnectedClientId} のクラッシュ通知タイマーセット。`);
                    }
                    connectedClients.delete(ws);
                } else {
                    console.log(`[WebSocket] 未登録/情報なしクライアント ${ws.clientId || 'ID不明'} が切断。Code: ${code}, Reason: ${reasonStr}`);
                }
                console.log(`[WebSocket] 現在接続数: ${connectedClients.size}`);
            });

            ws.on('error', (error) => {
                console.error(`[WebSocket] エラー (${ws.clientId || 'ID不明'}):`, error.message);
            });

        } else {
            console.warn(`[WebSocket] 無効/不明トークン (${token ? token.substring(0,8)+'...' : 'なし'}) のため接続拒否。IP: ${clientIp}`);
            ws.send(JSON.stringify({ type: 'auth_failed', message: 'Invalid or missing token.' }));
            ws.close(1008, 'Invalid or missing token');
        }
    });

    const checkInterval = setInterval(() => {
        connectedClients.forEach((clientInfo, wsInstance) => {
            const timeoutThreshold = (heartbeatInterval * 2) + (heartbeatInterval / 2); // 例: 30秒なら75秒
            const timeSinceLastSeen = Date.now() - clientInfo.lastSeen;

            // console.log(`[WebSocket Debug Timeout Check] Client: ${clientInfo.id}, LastSeen: ${formatTimeAgo(clientInfo.lastSeen)} (${timeSinceLastSeen}ms ago), Threshold: ${timeoutThreshold}ms`);

            if (timeSinceLastSeen > timeoutThreshold) {
                console.log(`[WebSocket] クライアント ${clientInfo.id} (IP: ${clientInfo.ip}) がサーバー側タイムアウト (最終確認: ${formatTimeAgo(clientInfo.lastSeen)}, ${timeSinceLastSeen}ms経過 > ${timeoutThreshold}ms)。接続を切断します。`);
                wsInstance.terminate();
            }
        });
    }, heartbeatInterval);

    wss.on('close', () => {
        clearInterval(checkInterval);
        disconnectedClientTimers.forEach(timerData => clearTimeout(timerData.timerId));
        disconnectedClientTimers.clear();
        console.log('[WebSocketHandler] WebSocketサーバーがシャットダウン。');
    });
    return wss;
}

function formatTimeAgo(timestamp) {
    if (!timestamp) return '不明';
    const now = Date.now();
    const seconds = Math.round((now - timestamp) / 1000);
    if (seconds < 5) return 'たった今';
    if (seconds < 60) return `${seconds}秒前`;
    const minutes = Math.round(seconds / 60);
    if (minutes < 60) return `${minutes}分前`;
    const hours = Math.round(minutes / 60);
    if (hours < 24) return `${hours}時間前`;
    const days = Math.round(hours / 24);
    return `${days}日前`;
}

module.exports = { initializeWebSocketServer };