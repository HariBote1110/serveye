// commands/serverstatus.js
const { EmbedBuilder, SlashCommandBuilder } = require('discord.js'); // SlashCommandBuilder をインポート

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

module.exports = {
    data: new SlashCommandBuilder() // SlashCommandBuilder を使用
        .setName('serverstatus')
        .setDescription('登録済みサーバーのステータス一覧を表示します。'),
    async execute(interaction, generatedTokens, connectedClients) { // connectedClients も受け取る
        const embed = new EmbedBuilder()
            .setTitle('🖥️ サーバー ステータス一覧')
            .setColor(0x5865F2) // Discord ブルー
            .setTimestamp()
            .setFooter({ text: `最終更新` });

        if (generatedTokens.size === 0) {
            embed.setDescription('監視対象として登録されているサーバーはありません。\n`/generatetoken` でサーバーを登録してください。');
        } else {
            const fields = [];
            generatedTokens.forEach((tokenData, tokenString) => { // tokenString はキー
                const displayName = tokenData.clientId; // トークン発行時のID
                let statusIndicator = '❓'; // Unknown
                let statusText = `状態不明 (最終確認: ${formatTimeAgo(tokenData.lastSeen) || 'なし'})`;
                let isCurrentlyConnected = false;

                // connectedClients Map を調べて、現在のリアルタイムな接続状態を確認
                for (const [_ws, rtInfo] of connectedClients) {
                    if (rtInfo.token === tokenString) { // トークン文字列で比較
                        isCurrentlyConnected = true;
                        // 実行時情報があればそちらの lastSeen を優先してもよいが、
                        // tokenData.lastSeen が WebSocketHandler で更新されるのでそれを信頼する
                        break;
                    }
                }

                if (isCurrentlyConnected) { // 現在WebSocket接続がある
                    statusIndicator = '✅';
                    statusText = `オンライン: ${formatTimeAgo(tokenData.lastSeen)}`;
                    // tokenData.status が 'online' であることも確認した方がより正確
                    // if (tokenData.status !== 'online') {
                    //     statusText += ' (記録不整合の可能性)';
                    // }
                } else { // 現在WebSocket接続がない
                    if (tokenData.status === 'offline') {
                        statusIndicator = '❌';
                        statusText = `オフライン: ${formatTimeAgo(tokenData.lastSeen)}`;
                    } else if (tokenData.status === 'online') {
                        // 記録上はオンラインだが、実際には接続がない ( Bot再起動直後など )
                        statusIndicator = '⚠️';
                        statusText = `オフライン (前回オンライン: ${formatTimeAgo(tokenData.lastSeen)})`;
                    } else { // unknown など
                        statusIndicator = '❔';
                        statusText = `状態不明 (最終確認: ${formatTimeAgo(tokenData.lastSeen) || 'なし'})`;
                    }
                }

                fields.push({
                    name: `${statusIndicator} ${displayName}`,
                    value: `${statusText}\n(実ホスト: \`${tokenData.actualHost || '未確認'}\`)`,
                    inline: true
                });
            });

            // フィールドを3列に近づけるためのパディング (オプション)
            const requiredEmptyFields = (3 - (fields.length % 3)) % 3;
            for (let i = 0; i < requiredEmptyFields; i++) {
                fields.push({ name: '\u200B', value: '\u200B', inline: true }); // 空白フィールド
            }
            if (fields.length > 0) {
                embed.addFields(fields);
            } else {
                 embed.setDescription('表示できるサーバー情報がありません。');
            }
        }
        await interaction.reply({ embeds: [embed] });
    }
};