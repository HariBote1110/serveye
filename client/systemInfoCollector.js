// systemInfoCollector.js
const os = require('os');
const si = require('systeminformation');

async function getSystemInfo() {
    try {
        const [cpuData, memData, osData, timeData] = await Promise.all([
            si.currentLoad(), // CPU負荷情報
            si.mem(),         // メモリ情報
            si.osInfo(),      // OS情報
            si.time()         // システム時刻情報 (uptime含む)
        ]);

        // OS標準モジュールからも補足的に情報を取得
        const cpus = os.cpus();
        const cpuModel = cpus.length > 0 ? cpus[0].model : 'N/A';

        return {
            cpuModel: cpuModel,
            cpuLoadPercent: cpuData.currentLoad !== null && cpuData.currentLoad !== undefined ? cpuData.currentLoad.toFixed(1) : 'N/A',
            totalMemoryGB: (memData.total / (1024 ** 3)).toFixed(2),
            usedMemoryGB: (memData.used / (1024 ** 3)).toFixed(2),
            memoryUsagePercent: memData.total > 0 ? ((memData.used / memData.total) * 100).toFixed(1) : 'N/A',
            osType: `${osData.platform} ${osData.distro} ${osData.release} (${osData.arch})`,
            uptimeHours: (timeData.uptime / 3600).toFixed(1),
            hostname: osData.hostname || os.hostname() // systeminformationから取得したものを優先
        };
    } catch (error) {
        console.error('[SystemInfoCollector] システム情報の取得中にエラー:', error);
        throw new Error(`システム情報の取得に失敗: ${error.message}`);
    }
}

module.exports = { getSystemInfo };