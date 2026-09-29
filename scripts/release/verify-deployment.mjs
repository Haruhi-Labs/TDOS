import assert from 'node:assert/strict';
import WebSocket from 'ws';
import { GAME_VERSION } from '../../shared/game-version.js';
const [web, wsUrl, sha, scope] = process.argv.slice(2);
let error;
for (let attempt = 0; attempt < 20; attempt += 1) {
  try {
    const response = await fetch(new URL('build-info.json', web), { signal: AbortSignal.timeout(2000) });
    const info = await response.json();
    assert.equal(info.commit, sha, '前端提交不匹配');
    assert.equal(info.gameVersion, GAME_VERSION, '前端公开版本不匹配');
    await new Promise((resolve, reject) => {
      const socket = new WebSocket(wsUrl);
      const timer = setTimeout(() => { socket.terminate(); reject(new Error('联机健康检查超时')); }, 2500);
      socket.on('error', reject);
      socket.on('message', raw => {
        const message = JSON.parse(String(raw));
        if (message.type !== 'connected') return;
        clearTimeout(timer); socket.close();
        try {
          if (scope === 'full') { assert.equal(message.buildId, sha); assert.equal(message.gameVersion, GAME_VERSION); }
          resolve();
        } catch (failure) { reject(failure); }
      });
      socket.on('close', () => clearTimeout(timer));
    });
    error = null; break;
  } catch (failure) { error = failure; await new Promise(resolve => setTimeout(resolve, 500)); }
}
if (error) throw error;
console.log('前端产物与联机握手验证通过');
