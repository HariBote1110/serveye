// index.js
const fs = require('node:fs');
const path = require('node:path');
const { Client, GatewayIntentBits, Collection, Routes, REST } = require('discord.js');
require('dotenv').config();
const { initializeWebSocketServer } = require('./websocketHandler');
const http = require('http');

const TOKENS_FILE_PATH = path.join(__dirname, 'tokens.json');

// --- 設定 ---
const BOT_TOKEN = process.env.BOT_TOKEN;
const WEBSOCKET_PORT = process.env.WEBSOCKET_PORT || 8080;
const BOT_PUBLIC_HOSTNAME = process.env.BOT_PUBLIC_HOSTNAME;
const DISCORD_LOG_CHANNEL_ID = process.env.DISCORD_LOG_CHANNEL_ID;
const PRIVATE_GUILD_ID = process.env.PRIVATE_GUILD_ID
const CLIENT_ID = process.env.CLIENT_ID;
const HEARTBEAT_INTERVAL = parseInt(process.env.HEARTBEAT_INTERVAL, 10) || 30 * 1000;

console.log(`[Config Check] BOT_TOKEN: ${BOT_TOKEN ? 'Loaded' : 'Not Loaded'}`);
console.log(`[Config Check] CLIENT_ID: ${CLIENT_ID}`);
console.log(`[Config Check] WEBSOCKET_PORT: ${WEBSOCKET_PORT}`);
console.log(`[Config Check] DISCORD_LOG_CHANNEL_ID: ${DISCORD_LOG_CHANNEL_ID}`);
console.log(`[Config Check] HEARTBEAT_INTERVAL (from index.js): ${HEARTBEAT_INTERVAL}ms`);

if (!BOT_TOKEN || !CLIENT_ID) {
    console.error('エラー: BOT_TOKEN または CLIENT_ID が .env で設定されていません。');
    process.exit(1);
}

const connectedClients = new Map(); // key: ws, value: clientRuntimeInfo
let generatedTokens = new Map();    // key: tokenString, value: tokenData (永続情報)

// --- トークン永続化関数 ---
function saveTokensToFile() {
    try {
        const tokensArray = Array.from(generatedTokens.entries());
        fs.writeFileSync(TOKENS_FILE_PATH, JSON.stringify(tokensArray, null, 2));
        // console.log('[Tokens] トークン情報をファイルに保存しました。'); // ログが多すぎる場合はコメントアウト
    } catch (error) {
        console.error('[Tokens] トークン情報保存エラー:', error);
    }
}

function loadTokensFromFile() {
    try {
        if (fs.existsSync(TOKENS_FILE_PATH)) {
            const data = fs.readFileSync(TOKENS_FILE_PATH, 'utf-8');
            if (data.trim() === '') { // ファイルが空の場合
                console.log('[Tokens] トークンファイルは空です。新しいMapで開始します。');
                generatedTokens = new Map();
                return;
            }
            const tokensArray = JSON.parse(data);
            generatedTokens = new Map(tokensArray.map(([token, tokenData]) => {
                return [token, {
                    clientId: tokenData.clientId,
                    issuedAt: tokenData.issuedAt || Date.now(),
                    used: tokenData.used || false,
                    status: tokenData.status || 'unknown',
                    lastSeen: tokenData.lastSeen || null,
                    actualHost: tokenData.actualHost || 'N/A',
                    connectedIp: tokenData.connectedIp || null,
                }];
            }));
            console.log('[Tokens] トークン情報をファイルから読み込みました。件数:', generatedTokens.size);
        } else {
            console.log('[Tokens] トークンファイルが見つかりません。新しいMapで開始します。');
            generatedTokens = new Map();
        }
    } catch (error) {
        console.error('[Tokens] トークン情報読み込みエラー:', error);
        generatedTokens = new Map();
    }
}

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
    ]
});

loadTokensFromFile(); // Bot起動時にファイルからトークンを読み込む

client.commands = new Collection();
const globalCommandsToDeploy = [];    // グローバルコマンド用
const privateCommandsToDeploy = []; // generatetoken 専用コマンド用
const commandsPath = path.join(__dirname, 'commands');

if (fs.existsSync(commandsPath)) {
    const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));
    for (const file of commandFiles) {
        const filePath = path.join(commandsPath, file);
        try {
            const command = require(filePath);
            if ('data' in command && 'execute' in command) {
                if (command.data.name === 'requestping') {
                    console.log(`[Commands] requestping コマンドはロードをスキップしました。`);
                    continue;
                }

                client.commands.set(command.data.name, command);

                if (command.data.name === 'generatetoken') {
                    // generatetoken コマンドは privateCommandsToDeploy 配列へ
                    privateCommandsToDeploy.push(command.data.toJSON()); // .toJSON() を推奨
                    console.log(`[Commands] プライベートコマンド ${command.data.name} を読み込みました。`);
                } else {
                    // それ以外のコマンドは globalCommandsToDeploy 配列へ
                    globalCommandsToDeploy.push(command.data.toJSON()); // .toJSON() を推奨
                    console.log(`[Commands] グローバルコマンド ${command.data.name} を読み込みました。`);
                }
            } else {
                console.log(`[警告] ${filePath} のコマンドには必要な "data" または "execute" プロパティがありません。`);
            }
        } catch (error) {
            console.error(`[エラー] コマンドファイル ${filePath} の読み込みに失敗しました:`, error);
        }
    }
} else {
    console.warn(`[警告] commands ディレクトリ (${commandsPath}) が見つかりません。コマンドは読み込まれません。`);
}

const rest = new REST({ version: '10' }).setToken(BOT_TOKEN);

(async () => {
    try {
        // グローバルコマンドの登録
        if (globalCommandsToDeploy.length > 0) {
            console.log(`${globalCommandsToDeploy.length} 個のグローバルコマンドを登録開始します。`);
            await rest.put(
                Routes.applicationCommands(CLIENT_ID),
                { body: globalCommandsToDeploy },
            );
            console.log('グローバルコマンドを正常に登録しました。(反映に時間がかかる場合があります)');
        } else {
            console.log('[Commands] 登録するグローバルコマンドはありません。');
        }

        // プライベートコマンド (generatetoken) の登録
        if (privateCommandsToDeploy.length > 0) {
            if (PRIVATE_GUILD_ID) {
                console.log(`${privateCommandsToDeploy.length} 個のプライベートコマンドをギルド ${PRIVATE_GUILD_ID} に登録開始します。`);
                await rest.put(
                    Routes.applicationGuildCommands(CLIENT_ID, PRIVATE_GUILD_ID),
                    { body: privateCommandsToDeploy },
                );
                console.log(`プライベートコマンドをギルド ${PRIVATE_GUILD_ID} に正常に登録しました。`);
            } else {
                console.warn('[Commands] プライベートコマンドを登録するための PRIVATE_GUILD_ID が設定されていません。generatetoken はどのサーバーでも使用できません。');
            }
        } else {
            console.log('[Commands] 登録するプライベートコマンドはありません。');
        }

    } catch (error) {
        console.error('[Commands] コマンドの登録中にエラーが発生しました:', error);
    }
})();

client.on('ready', () => {
    console.log(`Logged in as ${client.user.tag}!`);
});

client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;

    const command = client.commands.get(interaction.commandName);
    if (!command) {
        console.error(`コマンド ${interaction.commandName} が見つかりません。`);
        await interaction.reply({ content: 'このコマンドは存在しません。', ephemeral: true }).catch(console.error);
        return;
    }

    try {
        if (interaction.commandName === 'generatetoken') {
            await command.execute(interaction, generatedTokens, BOT_PUBLIC_HOSTNAME, WEBSOCKET_PORT, saveTokensToFile);
        } else if (interaction.commandName === 'serverstatus') {
            // serverstatus は connectedClients を第3引数で受け取っている (generatedTokens の後)
            await command.execute(interaction, generatedTokens, connectedClients);
        } else if (interaction.commandName === 'systeminfo' || interaction.commandName === 'cpuhistory' || interaction.commandName === 'memoryhistory') {
            // systeminfo, cpuhistory, memoryhistory は connectedClients を第2引数で受け取っている
            // ★ここの呼び出しで connectedClients (Map) が正しく渡っているはず
            await command.execute(interaction, connectedClients, generatedTokens, client);
        } else {
            await command.execute(interaction); // 引数なしで呼ぶコマンドもあるかもしれない
        }
    } catch (error) {
        console.error(`コマンド ${interaction.commandName} の実行中にエラーが発生しました:`, error);
        if (interaction.replied || interaction.deferred) {
            await interaction.followUp({ content: 'コマンドの実行中にエラーが発生しました。', ephemeral: true }).catch(console.error);
        } else {
            await interaction.reply({ content: 'コマンドの実行中にエラーが発生しました。', ephemeral: true }).catch(console.error);
        }
    }
});

const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('ServersEye Bot HTTP Server is running.\n');
});

console.log(`[WebSocketSetup] initializeWebSocketServer に渡す HEARTBEAT_INTERVAL: ${HEARTBEAT_INTERVAL}ms`);
const wss = initializeWebSocketServer(
    server,
    client,
    connectedClients,
    generatedTokens,
    null, // HTTPサーバーにアタッチするのでポートは server.listen で指定
    DISCORD_LOG_CHANNEL_ID,
    saveTokensToFile,
    HEARTBEAT_INTERVAL // サーバー側のタイムアウト処理に使用
);

server.listen(WEBSOCKET_PORT, () => {
    console.log(`HTTPサーバーがポート ${WEBSOCKET_PORT} で起動し、WebSocketサーバーも利用可能です。`);
});

client.login(BOT_TOKEN).catch(error => {
    console.error("Botのログインに失敗しました:", error);
    process.exit(1);
});