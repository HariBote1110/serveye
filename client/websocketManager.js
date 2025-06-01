// websocketManager.js
const WebSocket = require('ws');

// このモジュールは状態（wsインスタンス、再接続インターバルなど）を持つので、
// 関数をエクスポートするより、クラスやファクトリ関数にする方が管理しやすい場合がある。
// 今回はシンプルに、client.js から必要な情報を渡して関数を呼び出す形にする。

let wsInstance = null;
let currentReconnectInterval = 0;
let onMessageHandler = null; // メッセージ受信時のコールバック
let onOpenHandler = null;    // 接続成功時のコールバック
let onCloseHandler = null;   // 切断時のコールバック

function connectToServer(config, newOnOpen, newOnMessage, newOnClose) {
    if (wsInstance && (wsInstance.readyState === WebSocket.OPEN || wsInstance.readyState === WebSocket.CONNECTING)) {
        console.log('[WebSocketManager] 既に接続中または接続試行中です。');
        return;
    }

    onOpenHandler = newOnOpen;
    onMessageHandler = newOnMessage;
    onCloseHandler = newOnClose;

    currentReconnectInterval = config.initialReconnectInterval; // 再接続間隔を初期化

    const connectUrl = `${config.serverUrl}?token=${config.clientToken}`;
    console.log(`[WebSocketManager] サーバー ${config.serverUrl.split('?')[0]} (Token: ${config.clientToken.substring(0,8)}...) に接続試行中...`);

    try {
        wsInstance = new WebSocket(connectUrl);
    } catch (error) {
        console.error('[WebSocketManager] WebSocketインスタンスの作成に失敗しました:', error.message);
        scheduleReconnect(config); // config を渡す
        return;
    }

    wsInstance.onopen = () => {
        console.log(`[WebSocketManager] サーバーに正常に接続しました。`);
        currentReconnectInterval = config.initialReconnectInterval; // 接続成功でリセット
        if (onOpenHandler) onOpenHandler(wsInstance); // wsInstance を渡す
    };

    wsInstance.onmessage = (event) => {
        const messageString = event.data instanceof Buffer ? event.data.toString() : event.data;
        if (onMessageHandler) onMessageHandler(wsInstance, messageString); // wsInstance も渡す
    };

    wsInstance.onclose = (event) => {
        console.warn(`[WebSocketManager] サーバーとの接続が切れました。Code: ${event.code}, Reason: ${event.reason || '(理由なし)'}`);
        if (onCloseHandler) onCloseHandler(event); // イベントオブジェクトをそのまま渡す

        // 認証失敗など特定のエラーコードでは再接続しない
        if (event.code === 1008 && event.reason && (event.reason.includes('Authentication failed') || event.reason.includes('Token already in use'))) {
            console.error('[WebSocketManager] 認証/トークン問題で接続が閉じられたため、自動再接続は行いません。');
            wsInstance = null; // インスタンスをクリア
            return;
        }
        scheduleReconnect(config);
    };

    wsInstance.onerror = (error) => {
        console.error('[WebSocketManager] WebSocketエラー発生:', error.message);
        // oncloseが通常呼ばれるので、再接続はそちらに任せる。
        // ただし、接続確立前のエラーでoncloseが呼ばれない場合を考慮
        if (wsInstance.readyState !== WebSocket.OPEN && wsInstance.readyState !== WebSocket.CONNECTING) {
            scheduleReconnect(config);
        }
    };
}

function scheduleReconnect(config) {
    if (wsInstance && (wsInstance.readyState === WebSocket.OPEN || wsInstance.readyState === WebSocket.CONNECTING)) {
        return;
    }
    wsInstance = null; // 古いインスタンス参照をクリア
    console.log(`[WebSocketManager] ${currentReconnectInterval / 1000}秒後に再接続を試みます...`);
    setTimeout(() => connectToServer(config, onOpenHandler, onMessageHandler, onCloseHandler), currentReconnectInterval);
    currentReconnectInterval = Math.min(currentReconnectInterval * 1.5, config.maxReconnectInterval);
}

function getWsInstance() {
    return wsInstance;
}

function sendMessage(messageObject) {
    if (wsInstance && wsInstance.readyState === WebSocket.OPEN) {
        wsInstance.send(JSON.stringify(messageObject));
        return true;
    }
    console.warn('[WebSocketManager] メッセージ送信試行時、WebSocketが接続されていません。');
    return false;
}

function terminateConnection() {
    if (wsInstance) {
        console.log('[WebSocketManager] 接続を意図的に終了します。');
        wsInstance.terminate(); // 再接続ロジックが作動する
        wsInstance = null;
    }
}


module.exports = {
    connectToServer,
    getWsInstance,
    sendMessage,
    terminateConnection,
    // scheduleReconnect // 外部から直接呼ぶ必要はない想定
};