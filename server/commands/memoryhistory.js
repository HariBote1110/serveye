// commands/memoryhistory.js
const { SlashCommandBuilder, EmbedBuilder, AttachmentBuilder } = require('discord.js');
const { v4: uuidv4 } = require('uuid');
const WebSocket = require('ws'); // WebSocket.OPEN の比較のためにインポート
const { ChartJSNodeCanvas } = require('chartjs-node-canvas');

const MAX_SAMPLES_TO_DISPLAY = 60; // X軸に表示する最大のサンプル数 (解像度で調整した値)
const GRAPH_WIDTH = 800; // 例: 解像度で調整したグラフの幅
const GRAPH_HEIGHT = 400; // 例: 解像度で調整したグラフの高さ

async function generateImageGraph(data, width = GRAPH_WIDTH, height = GRAPH_HEIGHT) {
    if (!data || data.length === 0) {
        throw new Error('グラフを生成するためのデータがありません。');
    }

    const displayData = data.length > MAX_SAMPLES_TO_DISPLAY
        ? data.slice(data.length - MAX_SAMPLES_TO_DISPLAY)
        : data;

    const chartJSNodeCanvas = new ChartJSNodeCanvas({ width, height, backgroundColour: 'black' });

    const configuration = {
        type: 'line',
        data: {
            labels: displayData.map((_, i) => i + 1),
            datasets: [{
                label: 'メモリ 使用率 (%)', // ★変更
                data: displayData,
                borderColor: 'rgb(93, 109, 182)',  // ★色を変更 (例: 青系)
                backgroundColor: 'rgba(93, 109, 182)', // ★色を変更
                tension: 0.1,
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
                        text: 'メモリ 使用率 (%)' // ★変更
                    }
                },
                x: {
                    title: {
                        display: true,
                        text: `サンプル (新しいものが右)`
                    },
                    ticks: {
                        // autoSkip や maxRotation など、CPUグラフで調整した値を適用
                        autoSkip: true, // 必要に応じて false にして maxRotation 等で調整
                        // maxRotation: 45,
                        // stepSize: 10,
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
            animation: false,
        }
    };
    return chartJSNodeCanvas.renderToBuffer(configuration);
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('memoryhistory') // ★コマンド名変更
        .setDescription('指定クライアントが保持するメモリ使用率の推移を画像グラフで表示します。') // ★説明変更
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
                client.off(`memoryHistoryResponse_${requestId}`, listener); // ★イベント名変更
                reject(new Error(`クライアントからのメモリ履歴応答がタイムアウトしました (10秒)。`));
            }, 10000);

            const listener = (response) => {
                clearTimeout(timeout);
                client.off(`memoryHistoryResponse_${requestId}`, listener); // ★イベント名変更
                if (response.error) { reject(new Error(response.error)); }
                else { resolve(response.data); }
            };
            client.once(`memoryHistoryResponse_${requestId}`, listener); // ★イベント名変更
        });

        targetWs.send(JSON.stringify({
            type: 'request_memory_history', // ★要求タイプ変更
            requestId: requestId
        }));
        // console.log(`[DiscordCmd] クライアント ${targetClientId} にメモリ履歴リクエスト送信 (ID: ${requestId})`);

        try {
            const historyData = await waitForResponse;
            if (!historyData || !historyData.samples || !Array.isArray(historyData.samples)) {
                throw new Error('クライアントから有効なメモリ履歴データ(samples配列)が返されませんでした。');
            }

            const imageBuffer = await generateImageGraph(historyData.samples);
            const attachment = new AttachmentBuilder(imageBuffer, { name: 'memory-history-graph.png' }); // ★ファイル名変更

            const intervalSeconds = historyData.intervalMs !== undefined ? historyData.intervalMs / 1000 : 1;
            const displaySamplesCount = Math.min(historyData.samples.length, MAX_SAMPLES_TO_DISPLAY);

            const embed = new EmbedBuilder()
                .setTitle(`💾 メモリ使用率履歴: ${targetClientId}`) // ★タイトル変更
                .setColor(0x36A2EB) // ★色変更 (例: 青系)
                .setDescription(`クライアントが保持するメモリ使用率の推移です (直近最大${MAX_SAMPLES_TO_DISPLAY}件, 約 ${intervalSeconds}秒間隔)。`)
                .setImage('attachment://memory-history-graph.png') // ★添付ファイル名と一致
                .setTimestamp()
                .setFooter({ text: `Requested by ${interaction.user.tag}` });

            await interaction.editReply({ embeds: [embed], files: [attachment] });

        } catch (error) {
            console.error(`[DiscordCmd] MemoryHistoryエラー (${targetClientId}):`, error.message);
            const errorEmbed = new EmbedBuilder()
                .setTitle(`⚠️ エラー: ${targetClientId}`)
                .setColor(0xFF0000)
                .setDescription(error.message || 'メモリ履歴の取得およびグラフ生成中にエラーが発生しました。')
                .setTimestamp();
            await interaction.editReply({ embeds: [errorEmbed], files: [] });
        }
    }
};