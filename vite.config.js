import { defineConfig } from "vite";

// ─────────────────────────────────────────────────────────────
// 射手座之日 — 单页应用（SPA）构建配置
// · appType: 'spa'（默认）→ 开发期未知路径回退到 index.html，
//   从而支持无 .html 后缀的干净 URL（/play、/online、/debug …）。
// · /ws 代理到本地 WebSocket 对战服务端（server/server.js, 端口 21246），
//   使联机客户端可与前端同源连接。
// · base：生产构建默认使用根路径 /；本地 dev/preview 也使用根路径 /。
//   部署到子路径时通过 VITE_BASE 显式指定前缀，保证资源与路由保持一致。
// ─────────────────────────────────────────────────────────────
const DEPLOY_BASE = process.env.VITE_BASE || "/";
const BACKEND_HTTP_ORIGIN = process.env.VITE_BACKEND_ORIGIN || "http://localhost:21246";
const BACKEND_WS_ORIGIN = BACKEND_HTTP_ORIGIN.replace(/^http/i, "ws");

export default defineConfig(({ command }) => ({
  base: command === "build" ? DEPLOY_BASE : "/",
  appType: "spa",
  publicDir: "public",
  server: {
    port: 5173,
    proxy: {
      "/ws": {
        target: BACKEND_WS_ORIGIN,
        ws: true,
        changeOrigin: false,
      },
      "/api": {
        target: BACKEND_HTTP_ORIGIN,
        changeOrigin: false,
      },
    },
  },
  build: {
    target: "es2020",
    outDir: "dist",
    emptyOutDir: true,
  },
}));
