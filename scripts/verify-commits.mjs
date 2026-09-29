import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { checkEvent, checkRange, validateMessage } from './check-commits.mjs';

for (const message of [
  'feat(statistics): 按游戏版本查询胜率',
  'fix(server/rooms)!: 调整房间协议\n\n说明兼容性变化。\n\n(cherry picked from commit abc123)',
  'ci(commit-check): 校验 PR 标题（#4）',
  '# 提交消息注释\n\nrevert(ui): 撤回交互调整\r\n',
]) assert.doesNotThrow(() => validateMessage(message));
for (const message of [
  '', '修复统计', 'fix: 修复统计', 'FIX(stats): 修复统计',
  'fix(统计): 修复统计', 'fix(Stats): 修复统计', 'unknown(stats): 修复统计',
  'fix(stats): update statistics', 'fix(stats):  ', 'fix(stats):修复统计',
  'fix(stats): 修复统计 ', 'fix(stats): English subject\n\n中文详情不能替代中文标题',
  'Merge pull request #4 from example/branch',
]) assert.throws(() => validateMessage(message), /提交标题须为/);

const cwd = mkdtempSync(join(tmpdir(), 'tdos-commits-'));
const git = (...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const commit = message => {
  git('commit', '--allow-empty', '-m', message);
  return git('rev-parse', 'HEAD');
};
try {
  git('init', '-b', 'main');
  git('config', 'user.name', '提交规范测试');
  git('config', 'user.email', 'commit-test@example.invalid');
  git('config', 'commit.gpgsign', 'false');
  git('config', 'core.hooksPath', join(cwd, 'empty-hooks'));
  const base = commit('旧格式基线');
  const valid = commit('feat(stats): 新增版本统计');
  assert.equal(checkRange(base, valid, cwd), 1);
  assert.equal(checkEvent({ before: '0'.repeat(40), after: valid }, cwd), 1);
  assert.equal(checkEvent({ pull_request: { title: 'feat(stats): 新增统计', base: { sha: base }, head: { sha: valid } } }, cwd), 1);
  assert.throws(() => checkEvent({ pull_request: { title: '非规范标题', base: { sha: base }, head: { sha: valid } } }, cwd), /提交标题须为/);
  const invalid = commit('缺少类型和作用域');
  const newest = commit('docs(stats): 说明统计范围');
  assert.throws(() => checkRange(base, newest, cwd), new RegExp(invalid.slice(0, 12)));
  git('checkout', '-b', 'side', base);
  commit('fix(ui): 修复显示');
  git('checkout', 'main');
  git('merge', '--no-ff', 'side', '-m', '未规范的合并消息');
  assert.throws(() => checkRange(newest, 'HEAD', cwd), /提交标题须为/);
  git('commit', '--amend', '-m', 'chore(merge): 合并界面修复');
  assert.equal(checkRange(newest, 'HEAD', cwd), 2);
  assert.throws(() => checkEvent({}, cwd), /事件缺少提交范围/);

  const messageFile = join(cwd, 'message');
  const checker = resolve('scripts/check-commits.mjs');
  writeFileSync(messageFile, 'fix(stats): 修复归档\n');
  execFileSync(process.execPath, [checker, '--file', messageFile]);
  writeFileSync(messageFile, '非规范标题\n');
  assert.throws(() => execFileSync(process.execPath, [checker, '--file', messageFile], { stdio: 'pipe' }), error => error.status === 1);
  // 用真实 Git 提交验证钩子接线，而不只验证函数返回值。
  git('config', 'core.hooksPath', resolve('.githooks'));
  // 钩子从仓库根目录运行，将检查器放入隔离夹具的相同路径。
  mkdirSync(join(cwd, 'scripts'));
  copyFileSync(checker, join(cwd, 'scripts/check-commits.mjs'));
  assert.throws(() => git('commit', '--allow-empty', '-m', '不符合规范'), error => error.status !== 0);
  git('commit', '--allow-empty', '-m', 'test(commits): 验证本地钩子');
  console.log('提交格式、PR 标题、提交范围、合并提交与本地消息校验通过');
} finally {
  rmSync(cwd, { recursive: true, force: true });
}
