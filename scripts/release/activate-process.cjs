// PM2 同名 reload 会沿用旧入口；显式替换目标进程后核对实际入口与工作目录。
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { readFileSync, accessSync } = require('node:fs');
const path = require('node:path');
const [configPath, name] = process.argv.slice(2);
const app = JSON.parse(readFileSync(configPath, 'utf8')).apps.find(item => item.name === name);
assert.ok(app, '发布配置中缺少目标进程');
const cwd = path.resolve(app.cwd);
const script = path.resolve(cwd, app.script);
accessSync(script);
let exists = false;
try { execFileSync('pm2', ['describe', name], { stdio: 'ignore' }); exists = true; } catch (error) {
  if (error.status !== 1) throw error;
}
if (exists) execFileSync('pm2', ['delete', name], { stdio: 'ignore' });
execFileSync('pm2', ['start', configPath, '--only', name, '--update-env'], { stdio: 'ignore' });
const processes = JSON.parse(execFileSync('pm2', ['jlist'], { encoding: 'utf8' }));
const matches = processes.filter(item => item.name === name);
assert.equal(matches.length, 1, '目标进程数量不正确');
const actual = matches[0].pm2_env;
assert.equal(actual.pm_exec_path, script, '进程仍指向错误的发布入口');
assert.equal(actual.pm_cwd, cwd, '进程仍指向错误的发布目录');
assert.equal(actual.status, 'online', '目标进程未上线');
console.log(`进程入口已核对：${name}`);
