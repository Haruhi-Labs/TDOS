import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { chromium } from 'playwright';
const server = await createServer({ base: '/test-game/', define: { 'import.meta.env.VITE_DEPLOY_CHANNEL': JSON.stringify('staging') }, server: { host: '127.0.0.1', port: 0 }, logLevel: 'silent' });
await server.listen();
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  const identityRequests = [];
  page.on('request', request => { if (request.url().includes('/api/game/')) identityRequests.push(request.url()); });
  await page.addInitScript(() => {
    localStorage.setItem('haruhi-profile-v1', JSON.stringify({ nickname: '正式身份不应被读取', clientId: 'production-client', faction: 'red' }));
    localStorage.setItem('test-game:haruhi-locale-v1', 'zh');
  });
  const base = server.resolvedUrls.local[0];
  await page.goto(new URL('profile', base).href, { waitUntil: 'networkidle' });
  await page.getByText('测试服使用游客身份', { exact: true }).waitFor();
  assert.equal(await page.locator('#pvIdentityLogin').count(), 0);
  assert.notEqual(await page.locator('#pvNickname').inputValue(), '正式身份不应被读取');
  const results = await page.evaluate(async () => {
    const identity = await import('/test-game/src/identity.js');
    const connections = await import('/test-game/src/online/connection-target.js');
    await identity.refreshGameIdentity({ force: true });
    await identity.logoutGameIdentity();
    await identity.requestGameIdentityTicket();
    let denied = 0;
    try { await identity.beginGameIdentityLogin(); } catch { denied++; }
    try { await identity.completeGameIdentityLogin('?code=bad'); } catch { denied++; }
    return { denied, urls: connections.buildServerUrlCandidates(), original: localStorage.getItem('haruhi-profile-v1'), staging: localStorage.getItem('test-game:haruhi-profile-v1') };
  });
  assert.equal(results.denied, 2);
  assert.equal(results.urls.length, 1);
  assert.ok(results.urls[0].endsWith('/test-game/ws/'));
  assert.ok(results.original.includes('production-client'));
  assert.ok(results.staging && !results.staging.includes('production-client'));
  assert.deepEqual(identityRequests, [], '游客测试构建不能请求主站身份接口');
  await page.goto(base, { waitUntil: 'networkidle' });
  assert.match(await page.locator('.ts-ver-link').innerText(), /测试服/);
  console.log('测试服隔离校验通过：身份零请求、专属存储、专属联机地址和测试标识。');
} finally { await browser.close(); await server.close(); }
