import { defineConfig } from "vite";

// ─────────────────────────────────────────────────────────────
// 射手座之日 — 单页应用（SPA）构建配置
// · appType: 'spa'（默认）→ 开发期未知路径回退到 index.html，
//   从而支持无 .html 后缀的干净 URL（/play、/online、/debug …）。
// · /ws 代理到本地 WebSocket 对战服务端（server/server.js, 端口 21246），
//   使联机客户端可与前端同源连接。
// ─────────────────────────────────────────────────────────────
export default defineConfig({
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
});
