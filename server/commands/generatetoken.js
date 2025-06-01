// commands/generatetoken.js
const { EmbedBuilder, SlashCommandBuilder } = require('discord.js'); // SlashCommandBuilder をインポート
const { v4: uuidv4 } = require('uuid');

module.exports = {
    data: new SlashCommandBuilder() // SlashCommandBuilder を使用
        .setName('generatetoken')
        .setDescription('監視対象サーバー用の新しい認証トークンを生成します。')
        .addStringOption(option =>
            option.setName('client_id')
                .setDescription('クライアントを識別する名前（例: web-server-1）')
                .setRequired(true)),
    async execute(interaction, generatedTokens, BOT_PUBLIC_HOSTNAME, WEBSOCKET_PORT, saveTokensToFileFunc) {
        const userClientId = interaction.options.getString('client_id'); // これが表示名になる
        const botHostname = BOT_PUBLIC_HOSTNAME || interaction.client.user.username; // フォールバック
        const websocketPortToDisplay = WEBSOCKET_PORT || '8080'; // ポート表示用

        let existingTokenString = null;
        for (const [tokenStr, data] of generatedTokens) {
            if (data.clientId === userClientId) { // 同じclientIdのトークンを探す
                 // 有効な未使用トークンを再利用するより、常に新しいものを発行する方がシンプルかもしれない
                 // ここでは既存トークンがあっても新しいものを発行する方針で進めるか、
                 // または既存トークンを提示するか選択できる。今回は新しいものを発行する。
                 // if (!data.used) { existingTokenString = tokenStr; break; }
            }
        }

        const embed = new EmbedBuilder()
            .setTimestamp()
            .setFooter({ text: `Requested by ${interaction.user.tag}`, iconURL: interaction.user.displayAvatarURL() });

        // 常に新しいトークンを発行する方針（または既存未使用トークンがあればそれを提示）
        // if (existingTokenString) {
        //     embed.setTitle('既存のトークン情報')
        //         .setColor(0xFFCC00)
        //         .setDescription(`クライアントID \`${userClientId}\` には既にトークンが発行されています。\n以前のトークンを使用するか、必要であれば新しいトークンを再発行してください（別途コマンドが必要）。`)
        //         .addFields(
        //             { name: '既存トークン', value: `\`${existingTokenString}\`` },
        //             { name: '接続先 WebSocket サーバー', value: `\`ws://${botHostname}:${websocketPortToDisplay}\`` }
        //         );
        // } else {
        const newToken = uuidv4();
        generatedTokens.set(newToken, {
            clientId: userClientId,
            issuedAt: Date.now(),
            used: false,
            status: 'unknown',
            lastSeen: null,
            actualHost: 'N/A',
            connectedIp: null
        });
        console.log(`[Tokens] トークン ${newToken} をクライアントID '${userClientId}' 用に生成。`);

        if (saveTokensToFileFunc) {
            saveTokensToFileFunc();
        }

        embed.setTitle('新しい認証トークン生成完了')
            .setColor(0x00AE86)
            .setDescription(`クライアントID \`${userClientId}\` 用の新しいトークンを生成しました。\nこのトークンをクライアントPCのプログラムに設定してください。`)
            .addFields(
                { name: '生成されたトークン', value: `\`${newToken}\`` },
                { name: '接続先 WebSocket サーバー', value: `\`ws://${botHostname}:${websocketPortToDisplay}\`` },
                { name: 'クライアント側設定名', value: '`CLIENT_TOKEN` (client.js の .env ファイル内)'}
            );
        // }
        await interaction.reply({ embeds: [embed], ephemeral: true });
    }
};