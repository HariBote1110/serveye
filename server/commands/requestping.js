const { EmbedBuilder } = require('discord.js');
const { v4: uuidv4 } = require('uuid');

module.exports = {
    data: {
        name: 'requestping',
        description: '指定したクライアントにping実行をリクエストします。',
        options: [
            {
                name: 'client_id',
                type: 3, // STRING
                description: 'pingをリクエストするクライアントのID',
                required: true,
            },
            {
                name: 'target_host',
                type: 3, // STRING
                description: 'クライアントがpingする対象のホスト名/IP',
                required: true,
            }
        ]
    },
    async execute(interaction, connectedClients) {
        const targetClientId = interaction.options.getString('client_id');
        const targetHostToPing = interaction.options.getString('target_host');
        let clientFound = false;

        const embed = new EmbedBuilder()
            .setTimestamp()
            .setFooter({ text: `Requested by ${interaction.user.tag}`, iconURL: interaction.user.displayAvatarURL() });

        for (const [ws, clientData] of connectedClients.entries()) {
            if (clientData.id === targetClientId) {
                ws.send(JSON.stringify({
                    type: 'request_ping',
                    target: targetHostToPing,
                    requestId: uuidv4()
                }));
                clientFound = true;
                embed
                    .setTitle('Ping リクエスト送信')
                    .setColor(0x00AE86)
                    .setDescription(`クライアント \`${targetClientId}\` に \`${targetHostToPing}\` へのping実行をリクエストしました。\n結果はクライアントから通知され次第、このチャンネルに投稿されます。`);
                break;
            }
        }

        if (!clientFound) {
            embed
                .setTitle('Ping リクエスト失敗')
                .setColor(0xFF0000)
                .setDescription(`クライアントID \`${targetClientId}\` は現在接続していません。`);
        }
        await interaction.reply({ embeds: [embed], ephemeral: true });
    }
};