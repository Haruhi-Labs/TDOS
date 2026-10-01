#!/usr/bin/env bash
# 在发布主机运行。输入产物已由 CI 构建；不拉取浮动分支，不接触另一环境的数据。
set -euo pipefail
channel="${1:-}"; sha="${2:-}"; scope="${3:-}"; archive="${4:-}"
[[ "$channel" == staging || "$channel" == production ]] || { echo '部署环境无效' >&2; exit 1; }
[[ "$sha" =~ ^[a-f0-9]{40}$ && ( "$scope" == web || "$scope" == full ) ]] || { echo '提交号或部署范围无效' >&2; exit 1; }
root="${TDOS_DEPLOY_ROOT:-/srv/tdos}"
process_helper="$root/bin/activate-process.cjs"
[[ -f "$process_helper" ]] || { echo '缺少受控进程切换脚本' >&2; exit 1; }
[[ -f "$root/config/$channel.env" ]] || { echo '缺少服务器环境配置' >&2; exit 1; }
# 此文件由运维维护，包含该环境的端口、公钥及持久目录；不来自发布包。
set -a
source "$root/config/$channel.env"
set +a
: "${WEB_PORT:?}" "${WS_PORT:?}" "${STATS_DATA_DIR:?}"
if [[ "$channel" == staging ]]; then
  web_name=haruhi-dev-web; ws_name=haruhi-dev-ws; expected_base=/test-game/
  [[ "$WEB_PORT" == 21255 && "$WS_PORT" == 21256 && "$STATS_DATA_DIR" == "$root/staging/data/"* ]] || { echo '测试端口或数据目录未隔离' >&2; exit 1; }
  export GAME_AUTH_PUBLIC_KEY=''
else
  web_name=haruhi-star-web; ws_name=haruhi-ws; expected_base=/
fi
mkdir -p "$root/$channel/releases" "$STATS_DATA_DIR"
exec 9>"$root/$channel/deploy.lock"
flock -n 9 || { echo '该环境已有发布进行中' >&2; exit 1; }
release_dir="$root/$channel/releases/$sha"
[[ ! -e "$release_dir" ]] || { echo '该提交发布目录已存在；请使用回滚流程或核对前次失败，不覆盖不可变目录' >&2; exit 1; }
[[ "$STATS_DATA_DIR" != "$root/$channel/releases"* ]] || { echo '统计目录必须独立于发布目录' >&2; exit 1; }
mkdir "$release_dir"
tar -xzf "$archive" -C "$release_dir"
cd "$release_dir"
node --input-type=module - "$sha" "$channel" "$expected_base" <<'JS'
import { readFileSync } from 'node:fs';
const info = JSON.parse(readFileSync('dist/build-info.json'));
if (info.commit !== process.argv[2] || info.channel !== process.argv[3] || info.base !== process.argv[4]) throw new Error('产物身份不匹配');
JS
npm ci --omit=dev
export GAME_BUILD_ID="$sha"
export WEB_ROOT="$release_dir/dist"
export DEPLOY_RELEASE_DIR="$release_dir" WEB_PROCESS_NAME="$web_name" WS_PROCESS_NAME="$ws_name"
node scripts/release/pm2-config.cjs > "$release_dir/ecosystem.config.json"
previous_web="$(readlink "$root/$channel/current-web" || true)"
previous_server="$(readlink "$root/$channel/current-server" || true)"
restore() {
  echo '部署验证失败，恢复本次涉及的既有进程；统计数据保持不变' >&2
  if [[ -n "$previous_web" ]]; then node "$process_helper" "$previous_web/ecosystem.config.json" "$web_name"; else pm2 delete "$web_name" || true; fi
  if [[ "$scope" == full ]]; then
    if [[ -n "$previous_server" ]]; then node "$process_helper" "$previous_server/ecosystem.config.json" "$ws_name"; else pm2 delete "$ws_name" || true; fi
  fi
}
trap restore ERR
# 首次迁移现有进程时必须先登记旧版本配置，防止失败后丢失回滚目标。
if pm2 describe "$web_name" >/dev/null 2>&1 && [[ -z "$previous_web" ]]; then trap - ERR; echo '请先登记既有前端的回滚目录' >&2; exit 1; fi
if [[ "$scope" == full ]] && pm2 describe "$ws_name" >/dev/null 2>&1 && [[ -z "$previous_server" ]]; then trap - ERR; echo '请先登记既有联机服务的回滚目录' >&2; exit 1; fi
if [[ "$scope" == full ]]; then node "$process_helper" "$release_dir/ecosystem.config.json" "$ws_name"; fi
node "$process_helper" "$release_dir/ecosystem.config.json" "$web_name"
node scripts/release/verify-deployment.mjs "http://127.0.0.1:$WEB_PORT/" "ws://127.0.0.1:$WS_PORT/" "$sha" "$scope"
trap - ERR
ln -sfn "$release_dir" "$root/$channel/current-web"
if [[ "$scope" == full ]]; then ln -sfn "$release_dir" "$root/$channel/current-server"; fi
pm2 save
printf '部署完成：%s %s\n' "$channel" "$sha"
