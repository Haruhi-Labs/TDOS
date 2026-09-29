// 只输出必需配置；身份公钥可以随环境传递，私钥永远不在游戏服务中。
const path = require('node:path');
const cwd = process.env.DEPLOY_RELEASE_DIR;
const apps = [
  { name: process.env.WEB_PROCESS_NAME, cwd, script: path.join(cwd, 'serve.cjs'), env: { NODE_ENV: 'production', HOST: '127.0.0.1', PORT: process.env.WEB_PORT, WEB_ROOT: process.env.WEB_ROOT } },
  { name: process.env.WS_PROCESS_NAME, cwd, script: path.join(cwd, 'server/server.js'), env: { NODE_ENV: 'production', PORT: process.env.WS_PORT, GAME_BUILD_ID: process.env.GAME_BUILD_ID, STATS_DATA_DIR: process.env.STATS_DATA_DIR, STATS_HASH_SALT: process.env.STATS_HASH_SALT || '', GAME_AUTH_PUBLIC_KEY: process.env.GAME_AUTH_PUBLIC_KEY || '', GAME_AUTH_ISSUERS: process.env.GAME_AUTH_ISSUERS || '' } },
];
console.log(JSON.stringify({ apps }, null, 2));
