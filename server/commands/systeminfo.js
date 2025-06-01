// commands/systeminfo.js
const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { v4: uuidv4 } = require('uuid'); // リクエストID生成用

module.exports = {
    data: new SlashCommandBuilder()
        .setName('systeminfo')
        .setDescription('指定したクライアントのシステム構成情報を表示します。')
        .addStringOption(option =>
            option.setName('client_id')
                .setDescription('情報を取得するクライアントの登録名')
                .setRequired(true)),
    async execute(interaction, connectedClients, generatedTokens, client) { // client (Discord Client) を追加
        const targetClientId = interaction.options.getString('client_id');
        let targetWs = null;
        let targetTokenData = null;

        // 接続中のクライアントから探す
        for (const [ws, clientData] of connectedClients) {
            if (clientData.id === targetClientId) {
                targetWs = ws;
                targetTokenData = generatedTokens.get(clientData.token); // 永続情報も取得
                break;
            }
        }

        if (!targetWs || targetWs.readyState !== WebSocket.OPEN) {
            // 接続中でない場合でも、登録情報があるか確認
            let foundInGenerated = false;
            for (const [, tData] of generatedTokens) {
                if (tData.clientId === targetClientId) {
                    targetTokenData = tData;
                    foundInGenerated = true;
                    break;
                }
            }
            if (foundInGenerated && (!targetWs || targetWs.readyState !== WebSocket.OPEN)) {
                 await interaction.reply({
                    content: `クライアント \`${targetClientId}\` は現在接続していませんが、登録はされています。システム情報は取得できません。`,
                    ephemeral: true
                });
                return;
            }
            await interaction.reply({ content: `クライアント \`${targetClientId}\` が見つからないか、接続していません。`, ephemeral: true });
            return;
        }

        await interaction.deferReply({ ephemeral: false }); // 応答を保留 (全員に見えるように)

        const requestId = uuidv4();

        // リクエストに対する応答を待つためのPromise
        const waitForResponse = new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                client.off(`systemInfoResponse_${requestId}`, listener); // タイムアウトしたらリスナー解除
                reject(new Error('クライアントからのシステム情報応答がタイムアウトしました。'));
            }, 15000); // 15秒のタイムアウト

            const listener = (response) => {
                clearTimeout(timeout);
                client.off(`systemInfoResponse_${requestId}`, listener); // 応答があったらリスナー解除
                if (response.error) {
                    reject(new Error(response.error));
                } else {
                    resolve(response.data);
                }
            };
            // Discordクライアントのカスタムイベントで応答を待つ
            client.once(`systemInfoResponse_${requestId}`, listener);
        });

        // クライアントにシステム情報リクエストを送信
        targetWs.send(JSON.stringify({
            type: 'request_system_info',
            requestId: requestId
        }));
        console.log(`[DiscordCmd] クライアント ${targetClientId} にシステム情報リクエスト送信 (ID: ${requestId})`);

        try {
            const sysInfo = await waitForResponse;

            const embed = new EmbedBuilder()
                .setTitle(`🖥️ システム情報: ${targetClientId}`)
                .setColor(0x0099FF)
                .addFields(
                    { name: 'OS', value: sysInfo.osType || 'N/A', inline: true },
                    { name: 'ホスト名 (実)', value: `\`${sysInfo.hostname || targetTokenData?.actualHost || 'N/A'}\``, inline: true },
                    { name: '稼働時間', value: `${sysInfo.uptimeHours || 'N/A'} 時間`, inline: true },
                    { name: 'CPUモデル', value: sysInfo.cpuModel || 'N/A', inline: false },
                    { name: 'CPUコア数', value: String(sysInfo.cpuCores || 'N/A'), inline: true },
                    { name: '総メモリ', value: `${sysInfo.totalMemoryGB || 'N/A'} GB`, inline: true },
                    { name: '空きメモリ', value: `${sysInfo.freeMemoryGB || 'N/A'} GB`, inline: true }
                )
                .setTimestamp()
                .setFooter({ text: `Requested by ${interaction.user.tag}` });

            await interaction.editReply({ embeds: [embed] });

        } catch (error) {
            console.error(`[DiscordCmd] Systeminfoエラー (${targetClientId}):`, error.message);
            const errorEmbed = new EmbedBuilder()
                .setTitle(`⚠️ エラー: ${targetClientId}`)
                .setColor(0xFF0000)
                .setDescription(error.message || 'システム情報の取得中に不明なエラーが発生しました。')
                .setTimestamp();
            await interaction.editReply({ embeds: [errorEmbed] });
        }
    }
};