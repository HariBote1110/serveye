// cpuMonitor.js (または client.js 内に実装)
const si = require('systeminformation');

const CPU_HISTORY_LENGTH = 60; // 過去60サンプルを保持 (例: 1秒間隔なら過去60秒分)
const CPU_SAMPLE_INTERVAL_MS = 10000; // 1秒ごとにサンプリング

let cpuUsageHistory = []; // CPU使用率の履歴を保持する配列 (リングバッファとして使用)
let cpuMonitorIntervalId = null;

async function sampleCpuLoad() {
    try {
        const load = await si.currentLoad();
        const currentLoadPercent = load.currentLoad !== null && load.currentLoad !== undefined ? parseFloat(load.currentLoad.toFixed(1)) : null;

        if (cpuUsageHistory.length >= CPU_HISTORY_LENGTH) {
            cpuUsageHistory.shift(); // 古いデータから削除
        }
        cpuUsageHistory.push(currentLoadPercent);
        // console.log('[CpuMonitor] Sampled CPU Load:', currentLoadPercent, 'History size:', cpuUsageHistory.length); // デバッグ用
    } catch (error) {
        console.error('[CpuMonitor] CPU負荷のサンプリング中にエラー:', error);
        // エラー時も配列長を維持するためnullなどをpushしてもよいが、今回はエラーは記録しない形
    }
}

function startCpuMonitoring() {
    if (cpuMonitorIntervalId) {
        clearInterval(cpuMonitorIntervalId);
    }
    // 最初に一度実行して初期データを取得
    sampleCpuLoad();
    cpuMonitorIntervalId = setInterval(sampleCpuLoad, CPU_SAMPLE_INTERVAL_MS);
    console.log(`[CpuMonitor] CPU使用率の定期的サンプリングを開始しました (間隔: ${CPU_SAMPLE_INTERVAL_MS}ms, 保持数: ${CPU_HISTORY_LENGTH})。`);
}

function stopCpuMonitoring() {
    if (cpuMonitorIntervalId) {
        clearInterval(cpuMonitorIntervalId);
        cpuMonitorIntervalId = null;
        console.log('[CpuMonitor] CPU使用率の定期的サンプリングを停止しました。');
    }
}

function getCpuUsageHistory() {
    // 現在保持している履歴データを返す
    return [...cpuUsageHistory]; // コピーを返す
}

module.exports = {
    startCpuMonitoring,
    stopCpuMonitoring,
    getCpuUsageHistory,
    CPU_SAMPLE_INTERVAL_MS, // 間隔情報もエクスポート
    CPU_HISTORY_LENGTH      // 保持長もエクスポート
};