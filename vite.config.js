import { defineConfig } from "vite";

// ─────────────────────────────────────────────────────────────
// 射手座之日 — 单页应用（SPA）构建配置
// · appType: 'spa'（默认）→ 开发期未知路径回退到 index.html，
//   从而支持无 .html 后缀的干净 URL（/play、/online、/debug …）。
// · /ws 代理到本地 WebSocket 对战服务端（server/server.js, 端口 21246），
//   使联机客户端可与前端同源连接。
// · base：线上挂在 haruyuki.cn/test-game/ 子路径下，构建产物用 /test-game/
//   前缀（资源与路由都不会逃出子路径）；本地 dev/preview 仍用根路径 /。
//   可用环境变量 VITE_BASE 覆盖（便于换部署路径）。
// ─────────────────────────────────────────────────────────────
const DEPLOY_BASE = process.env.VITE_BASE || "/test-game/";

export default defineConfig(({ command }) => ({
  base: command === "build" ? DEPLOY_BASE : "/",
  appType: "spa",
  publicDir: "public",
  server: {
    port: 5173,
    proxy: {
      "/ws": {
        target: "ws://localhost:21246",
        ws: true,
        changeOrigin: true,
      },
    },
  },
  build: {
    target: "es2020",
    outDir: "dist",
    emptyOutDir: true,
  },
}));
