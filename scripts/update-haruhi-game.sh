#!/usr/bin/env bash
set -euo pipefail

# ===== 可按需修改的配置 =====
PROJECT_DIR="/root/haruhi-game"
WEB_NAME="haruhi-web"
WS_NAME="haruhi-ws"
WEB_PORT="21245"
WS_PORT="21246"
WEB_BIND="127.0.0.1"

echo ">>> 进入项目目录并拉取最新代码..."
cd "$PROJECT_DIR"
git pull

echo ">>> 安装/更新项目依赖..."
npm install

echo ">>> 运行核心逻辑校验..."
npm run test:core

echo ">>> 使用 PM2 管理前端静态服务（$WEB_NAME）..."
if pm2 describe "$WEB_NAME" >/dev/null 2>&1; then
  echo ">>> 检测到已有 PM2 进程 $WEB_NAME，执行重启..."
  pm2 restart "$WEB_NAME" --update-env
else
  echo ">>> 未检测到 PM2 进程，启动 $WEB_NAME ..."
  pm2 start "python3 -m http.server ${WEB_PORT} --bind ${WEB_BIND}" \
    --name "$WEB_NAME" \
    --cwd "$PROJECT_DIR"
fi

echo ">>> 使用 PM2 管理联机服务端（$WS_NAME）..."
if pm2 describe "$WS_NAME" >/dev/null 2>&1; then
  echo ">>> 检测到已有 PM2 进程 $WS_NAME，执行重启..."
  pm2 restart "$WS_NAME" --update-env
else
  echo ">>> 未检测到 PM2 进程，启动 $WS_NAME ..."
  PORT="$WS_PORT" NODE_ENV="production" \
    pm2 start server/server.js \
    --name "$WS_NAME" \
    --cwd "$PROJECT_DIR"
fi

echo ">>> 保存 PM2 当前进程列表..."
pm2 save

echo ">>> 检查并重载 Nginx 配置..."
nginx -t
systemctl reload nginx

echo ">>> 完成：射手座之日 已更新并重载。"
echo ">>> 可用地址：https://haruyuki.cn/test-game/"
