import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
const helper = resolve(import.meta.dirname, 'release/activate-process.cjs');
const directory = mkdtempSync(join(tmpdir(), 'tdos-process-test-'));
try {
  const bin = join(directory, 'bin');
  mkdirSync(bin);
  const stateFile = join(directory, 'state.json');
  writeFileSync(stateFile, '[]');
  // 模拟现场观察到的 PM2 行为：同名 start/reload 更新环境但保留旧入口。
  writeFileSync(join(bin, 'pm2'), `#!${process.execPath}
const fs = require('node:fs');
const file = process.env.TEST_PM2_STATE;
let processes = JSON.parse(fs.readFileSync(file));
const [command, target, , name] = process.argv.slice(2);
if (command === 'describe') process.exit(processes.some(p => p.name === target) ? 0 : 1);
if (command === 'delete') processes = processes.filter(p => p.name !== target);
if (command === 'start') {
  const app = JSON.parse(fs.readFileSync(target)).apps.find(p => p.name === name);
  if (process.env.TEST_PM2_FAIL_START) process.exit(1);
  if (!processes.some(p => p.name === name)) processes.push({ name, pm2_env: {
    pm_exec_path: process.env.TEST_PM2_WRONG_PATH ? '/old/server.js' : app.script,
    pm_cwd: app.cwd, status: 'online'
  }});
}
if (command === 'jlist') process.stdout.write(JSON.stringify(processes));
fs.writeFileSync(file, JSON.stringify(processes));
`, { mode: 0o755 });
  const env = { ...process.env, PATH: `${bin}:${process.env.PATH}`, TEST_PM2_STATE: stateFile };
  const configs = ['old', 'new'].map(version => {
    const cwd = join(directory, version);
    mkdirSync(cwd);
    const script = join(cwd, 'server.cjs');
    writeFileSync(script, 'setInterval(() => {}, 1000);');
    const config = join(cwd, 'ecosystem.config.json');
    writeFileSync(config, JSON.stringify({ apps: ['target', 'untouched'].map(name => ({ name, cwd, script })) }));
    return config;
  });
  const activate = (config, name = 'target', extra = {}) => execFileSync(process.execPath, [helper, config, name], { env: { ...env, ...extra }, stdio: 'pipe' });
  const processes = () => JSON.parse(readFileSync(stateFile));
  activate(configs[0]);
  activate(configs[0], 'untouched');
  const untouched = processes().find(p => p.name === 'untouched');
  activate(configs[1]);
  assert.equal(processes().find(p => p.name === 'target').pm2_env.pm_cwd, join(directory, 'new'));
  assert.deepEqual(processes().find(p => p.name === 'untouched'), untouched, '切换不得影响其它进程');
  assert.throws(() => activate(configs[1], 'target', { TEST_PM2_WRONG_PATH: '1' }), /进程仍指向错误/, '实际入口不符必须拒绝');
  activate(configs[0]);
  assert.equal(processes().find(p => p.name === 'target').pm2_env.pm_cwd, join(directory, 'old'), '回滚应恢复旧入口');
  assert.throws(() => activate(configs[1], 'target', { TEST_PM2_FAIL_START: '1' }));
  activate(configs[0]);
  assert.deepEqual(processes().find(p => p.name === 'untouched'), untouched, '失败恢复不得影响其它进程');
  assert.throws(() => activate(configs[1], 'missing'), /发布配置中缺少目标进程/);
  console.log('发布进程切换校验通过：实际入口更新、失败拒绝、回滚和其它进程隔离。');
} finally {
  rmSync(directory, { recursive: true, force: true });
}
