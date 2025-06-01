// memoryMonitor.js
const si = require('systeminformation');

const MEMORY_HISTORY_LENGTH = 60; // 保持するサンプル数 (CPUと同様で良いか、必要なら調整)
const MEMORY_SAMPLE_INTERVAL_MS = 10000; // サンプリング間隔 (CPUと同様で良いか、必要なら調整)

let memoryUsageHistory = []; // メモリ使用率 (%) の履歴
let memoryMonitorIntervalId = null;

async function sampleMemoryUsage() {
    try {
        const memData = await si.mem();
        // memData.used と memData.total はバイト単位
        const currentUsagePercent = memData.total > 0 ? parseFloat(((memData.used / memData.total) * 100).toFixed(1)) : null;

        if (memoryUsageHistory.length >= MEMORY_HISTORY_LENGTH) {
            memoryUsageHistory.shift(); // 古いデータから削除
        }
        memoryUsageHistory.push(currentUsagePercent);
        // console.log('[MemoryMonitor] Sampled Memory Usage:', currentUsagePercent, '% History size:', memoryUsageHistory.length); // デバッグ用
    } catch (error) {
        console.error('[MemoryMonitor] メモリ使用率のサンプリング中にエラー:', error);
    }
}

function startMemoryMonitoring() {
    if (memoryMonitorIntervalId) {
        clearInterval(memoryMonitorIntervalId);
    }
    sampleMemoryUsage(); // 最初に一度実行
    memoryMonitorIntervalId = setInterval(sampleMemoryUsage, MEMORY_SAMPLE_INTERVAL_MS);
    console.log(`[MemoryMonitor] メモリ使用率の定期的サンプリングを開始しました (間隔: ${MEMORY_SAMPLE_INTERVAL_MS}ms, 保持数: ${MEMORY_HISTORY_LENGTH})。`);
}

function stopMemoryMonitoring() {
    if (memoryMonitorIntervalId) {
        clearInterval(memoryMonitorIntervalId);
        memoryMonitorIntervalId = null;
        console.log('[MemoryMonitor] メモリ使用率の定期的サンプリングを停止しました。');
    }
}

function getMemoryUsageHistory() {
    return [...memoryUsageHistory]; // コピーを返す
}

module.exports = {
    startMemoryMonitoring,
    stopMemoryMonitoring,
    getMemoryUsageHistory,
    MEMORY_SAMPLE_INTERVAL_MS,
    MEMORY_HISTORY_LENGTH
};