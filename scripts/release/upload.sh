#!/usr/bin/env bash
set -euo pipefail
channel="$1"; sha="$2"; scope="$3"
: "${DEPLOY_HOST:?}" "${DEPLOY_USER:?}" "${DEPLOY_SSH_KEY:?}" "${DEPLOY_KNOWN_HOSTS:?}"
key_dir="$(mktemp -d)"
trap 'rm -rf "$key_dir"' EXIT
printf '%s\n' "$DEPLOY_SSH_KEY" > "$key_dir/key"
printf '%s\n' "$DEPLOY_KNOWN_HOSTS" > "$key_dir/known_hosts"
chmod 600 "$key_dir/key"
ssh_options=(-i "$key_dir/key" -o BatchMode=yes -o StrictHostKeyChecking=yes -o "UserKnownHostsFile=$key_dir/known_hosts")
remote="$DEPLOY_USER@$DEPLOY_HOST"
archive="/tmp/tdos-$channel-$sha.tgz"
scp "${ssh_options[@]}" release.tgz "$remote:$archive"
# 使用已安装的受控入口；不要通过下载后的任意 shell 字符串执行发布命令。
ssh "${ssh_options[@]}" "$remote" "/srv/tdos/bin/deploy.sh '$channel' '$sha' '$scope' '$archive'"
