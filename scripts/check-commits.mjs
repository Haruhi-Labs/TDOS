import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

// 仅兼容引入规范前已经共享的三个提交；新 SHA（包括重新择取）不豁免。
const legacyCommits = new Set([
  '8eb073cb6e43df5f1b675fd8912b18a055f2b7d5',
  'aba0fd008c7e2cdbe33e569afc3589ced29adbe3',
  'a218bf00ff5a14fa056f3ca144682a37d3c95650',
]);
const subjectPattern = /^(feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert)\([a-z][a-z0-9]*(?:[/-][a-z0-9]+)*\)!?: (\S(?:.*\S)?)$/u;

export function validateMessage(message) {
  const subject = String(message).split(/\r?\n/).find(line => line.trim() && !line.startsWith('#')) || '';
  const match = subjectPattern.exec(subject);
  if (!match || !/\p{Script=Han}/u.test(match[2])) {
    throw new Error('提交标题须为 type(scope): 中文正文；类型和作用域使用英文小写，作用域必填，例如 fix(statistics): 修复跨版本胜率混算');
  }
  return subject;
}

function git(args, cwd) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

export function checkRange(base, head, cwd = process.cwd()) {
  // 先解析为完整提交 SHA，避免参数被 Git 当成选项或范围表达式。
  const resolve = ref => git(['rev-parse', '--verify', '--end-of-options', `${ref}^{commit}`], cwd);
  const headSha = resolve(head);
  const revisions = base && !/^0{40}$/.test(base)
    ? [`${resolve(base)}..${headSha}`]
    : ['-1', headSha];
  const commits = git(['rev-list', ...revisions], cwd).split('\n').filter(Boolean);
  const failures = [];
  for (const sha of commits) {
    if (legacyCommits.has(sha)) continue;
    try {
      validateMessage(git(['show', '-s', '--format=%B', sha], cwd));
    } catch (error) {
      failures.push(`${sha.slice(0, 12)}：${error.message}`);
    }
  }
  if (failures.length) throw new Error(failures.join('\n'));
  return commits.length;
}

export function checkEvent(event, cwd = process.cwd()) {
  if (event.pull_request) {
    validateMessage(event.pull_request.title);
    return checkRange(event.pull_request.base.sha, event.pull_request.head.sha, cwd);
  }
  if (event.deleted) return 0;
  if (!event.before || !event.after) throw new Error('事件缺少提交范围，无法校验');
  return checkRange(event.before, event.after, cwd);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const [mode, first, second] = process.argv.slice(2);
    if (mode === '--file' && first) validateMessage(readFileSync(first, 'utf8'));
    else if (mode === '--range' && first && second) checkRange(first, second);
    else if (mode === '--event' && first) checkEvent(JSON.parse(readFileSync(first, 'utf8')));
    else throw new Error('用法：check-commits.mjs --file <消息文件> | --range <基线> <候选> | --event <GitHub事件文件>');
    console.log('提交格式校验通过');
  } catch (error) {
    console.error(`提交格式校验失败：${error.message}`);
    process.exitCode = 1;
  }
}
