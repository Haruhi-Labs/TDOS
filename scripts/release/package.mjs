import { execFileSync } from 'node:child_process';
import { mkdtempSync, cpSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { GAME_VERSION } from '../../shared/game-version.js';
const channel = process.argv[2];
if (!['staging', 'production'].includes(channel)) throw new Error('必须指定 staging 或 production');
if (execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim()) throw new Error('发布包只接受干净且已提交的候选');
const commit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const base = channel === 'staging' ? '/test-game/' : '/';
execFileSync('npm', ['run', 'build'], { stdio: 'inherit', env: { ...process.env, VITE_BASE: base, VITE_DEPLOY_CHANNEL: channel, VITE_BUILD_ID: commit } });
writeFileSync('dist/build-info.json', JSON.stringify({ commit, channel, base, gameVersion: GAME_VERSION }) + '\n');
const directory = mkdtempSync(join(tmpdir(), 'tdos-release-'));
try {
  const source = join(directory, 'source.tar');
  execFileSync('git', ['archive', '--output', source, 'HEAD']);
  execFileSync('tar', ['-xf', source, '-C', directory]);
  rmSync(source);
  cpSync('dist', join(directory, 'dist'), { recursive: true });
  execFileSync('tar', ['--no-xattrs', '-czf', resolve('release.tgz'), '-C', directory, '.'], { env: { ...process.env, COPYFILE_DISABLE: '1' } });
} finally { rmSync(directory, { recursive: true, force: true }); }
console.log(`已生成 ${channel} 发布包：${commit}`);
