// commands/cpuhistory.js
const { SlashCommandBuilder, EmbedBuilder, AttachmentBuilder } = require('discord.js'); // AttachmentBuilder を追加
const { v4: uuidv4 } = require('uuid');
const WebSocket = require('ws');
const { ChartJSNodeCanvas } = require('chartjs-node-canvas'); // ChartJSNodeCanvas を追加

const MAX_SAMPLES_TO_DISPLAY = 60; // 表示する最大のサンプル数 (これはX軸のラベル数などにも影響)

// 新しい画像グラフ生成関数
async function generateImageGraph(data, width = 1200, height = 600) {
    if (!data || data.length === 0) {
        throw new Error('グラフを生成するためのデータがありません。');
    }

    const displayData = data.length > MAX_SAMPLES_TO_DISPLAY
        ? data.slice(data.length - MAX_SAMPLES_TO_DISPLAY)
        : data;

    const chartJSNodeCanvas = new ChartJSNodeCanvas({ width, height, backgroundColour: 'black' }); // 背景色などを設定可能

    const configuration = {
        type: 'line',
        data: {
            labels: displayData.map((_, i) => i + 1), // 単純な連番ラベル (必要に応じて時刻などに変更)
            datasets: [{
                label: 'CPU 使用率 (%)',
                data: displayData,
                borderColor: 'rgb(75, 192, 192)',
                backgroundColor: 'rgba(75, 192, 192, 0.5)',
                tension: 0.1, // 線の滑らかさ
                fill: true,
            }],
        },
        options: {
            scales: {
                y: {
                    beginAtZero: true,
                    max: 100,
                    title: {
                        display: true,
                        text: 'CPU 使用率 (%)'
                    }
                },
                x: {
                    title: {
                        display: true,
                        text: `サンプル`
                    }
                }
            },
            plugins: {
                legend: {
                    display: true,
                    position: 'top',
                },
                tooltip: {
                    enabled: true,
                }
            },
            animation: false, // サーバーサイドではアニメーションは不要
        }
    };
    return chartJSNodeCanvas.renderToBuffer(configuration);
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('cpuhistory')
        .setDescription('指定クライアントが保持するCPU使用率の推移を画像グラフで表示します。')
        .addStringOption(option =>
            option.setName('client_id')
                .setDescription('情報を取得するクライアントの登録名')
                .setRequired(true)),

    async execute(interaction, connectedClients, _generatedTokens, client) {
        const targetClientId = interaction.options.getString('client_id');
        let targetWs = null;

        for (const [ws, clientData] of connectedClients) {
            if (clientData.id === targetClientId) {
                targetWs = ws;
                break;
            }
        }

        if (!targetWs || targetWs.readyState !== WebSocket.OPEN) {
            await interaction.reply({ content: `クライアント \`${targetClientId}\` が見つからないか、接続していません。`, ephemeral: true });
            return;
        }

        await interaction.deferReply({ ephemeral: false });
        const requestId = uuidv4();

        const waitForResponse = new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                client.off(`cpuHistoryResponse_${requestId}`, listener);
                reject(new Error(`クライアントからのCPU履歴応答がタイムアウトしました (10秒)。`));
            }, 10000);

            const listener = (response) => {
                clearTimeout(timeout);
                client.off(`cpuHistoryResponse_${requestId}`, listener);
                if (response.error) { reject(new Error(response.error)); }
                else { resolve(response.data); }
            };
            client.once(`cpuHistoryResponse_${requestId}`, listener);
        });

        targetWs.send(JSON.stringify({
            type: 'request_cpu_history',
            requestId: requestId
        }));

        try {
            const historyData = await waitForResponse;
            if (!historyData || !historyData.samples || !Array.isArray(historyData.samples)) {
                throw new Error('クライアントから有効なCPU履歴データ(samples配列)が返されませんでした。');
            }

            const imageBuffer = await generateImageGraph(historyData.samples);
            const attachment = new AttachmentBuilder(imageBuffer, { name: 'cpu-history-graph.png' });

            const intervalSeconds = historyData.intervalMs !== undefined ? historyData.intervalMs / 1000 : 1;
            const displaySamplesCount = Math.min(historyData.samples.length, MAX_SAMPLES_TO_DISPLAY);
            // const actualDurationSeconds = displaySamplesCount * intervalSeconds; // 表示期間の目安

            const embed = new EmbedBuilder()
                .setTitle(`📊 CPU使用率履歴: ${targetClientId}`)
                .setColor(0x2ECC71)
                .setDescription(`クライアントが保持するCPU使用率の推移です (直近最大${MAX_SAMPLES_TO_DISPLAY}件, 約 ${intervalSeconds}秒間隔)。`)
                .setImage('attachment://cpu-history-graph.png') // 添付ファイル名と一致させる
                .setTimestamp()
                .setFooter({ text: `Requested by ${interaction.user.tag}` });

            await interaction.editReply({ embeds: [embed], files: [attachment] });

        } catch (error) {
            console.error(`[DiscordCmd] CpuHistoryエラー (${targetClientId}):`, error.message);
            const errorEmbed = new EmbedBuilder()
                .setTitle(`⚠️ エラー: ${targetClientId}`)
                .setColor(0xFF0000)
                .setDescription(error.message || 'CPU履歴の取得およびグラフ生成中にエラーが発生しました。')
                .setTimestamp();
            await interaction.editReply({ embeds: [errorEmbed], files: [] }); // エラー時はファイルを添付しない
        }
    }
};