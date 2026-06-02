// ═══════════════════════════════════════════════════════════════
// 极简零依赖静态服务器（SPA fallback）—— 用于线上 haruhi-web 进程
// · 取代 python3 -m http.server：原版对 /play 等深链直接 404，刷新即丢页。
// · 行为：
//   - 命中真实文件 → 按扩展名返回正确 Content-Type；
//   - 带扩展名但文件不存在 → 404（避免把 HTML 当成 .js/.webp 回给浏览器）；
//   - 无扩展名/未知路径（即前端路由）→ 回 index.html，交给 SPA 路由。
// · 缓存：/assets/ 下是 Vite 带 hash 的不可变产物 → 一年强缓存；
//   其余（index.html 等）→ no-cache，保证发版后立即生效。
// · 仅监听本机（默认 127.0.0.1:21245），由 nginx 反代 /test-game/ → 这里。
// · 路径穿越防护：解析后必须仍在 WEB_ROOT 内。
// 配置：环境变量 PORT / HOST / WEB_ROOT（默认 ./dist 相对本文件）。
// ═══════════════════════════════════════════════════════════════
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const PORT = Number(process.env.PORT || 21245);
const HOST = process.env.HOST || "127.0.0.1";
const ROOT = path.resolve(process.env.WEB_ROOT || path.join(__dirname, "dist"));
const INDEX = path.join(ROOT, "index.html");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webp": "image/webp",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".ttf": "font/ttf",
  ".map": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".wasm": "application/wasm",
};

function send(res, status, headers, body) {
  res.writeHead(status, headers);
  if (body && res.req && res.req.method === "HEAD") {
    res.end();
  } else {
    res.end(body);
  }
}

function serveFile(res, filePath, { spa = false } = {}) {
  fs.stat(filePath, (err, st) => {
    if (err || !st.isFile()) {
      if (spa) return serveIndex(res);
      return send(res, 404, { "Content-Type": "text/plain; charset=utf-8" }, "404 Not Found");
    }
    const ext = path.extname(filePath).toLowerCase();
    const type = MIME[ext] || "application/octet-stream";
    // /assets/ 下是带 hash 的不可变产物，长缓存；其余不缓存以便发版即生效
    const isImmutable = filePath.startsWith(path.join(ROOT, "assets") + path.sep);
    const cache = isImmutable
      ? "public, max-age=31536000, immutable"
      : "no-cache";
    const headers = {
      "Content-Type": type,
      "Content-Length": st.size,
      "Cache-Control": cache,
      "Last-Modified": st.mtime.toUTCString(),
    };
    if (res.req.method === "HEAD") return send(res, 200, headers);
    const stream = fs.createReadStream(filePath);
    stream.on("error", () =>
      send(res, 500, { "Content-Type": "text/plain; charset=utf-8" }, "500"),
    );
    res.writeHead(200, headers);
    stream.pipe(res);
  });
}

function serveIndex(res) {
  fs.readFile(INDEX, (err, buf) => {
    if (err) {
      return send(res, 500, { "Content-Type": "text/plain; charset=utf-8" }, "index.html missing");
    }
    const headers = {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Length": buf.length,
      "Cache-Control": "no-cache",
    };
    if (res.req.method === "HEAD") return send(res, 200, headers);
    send(res, 200, headers, buf);
  });
}

const server = http.createServer((req, res) => {
  if (req.method !== "GET" && req.method !== "HEAD") {
    return send(res, 405, { Allow: "GET, HEAD" }, "405 Method Not Allowed");
  }
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url, "http://x").pathname);
  } catch {
    return send(res, 400, { "Content-Type": "text/plain; charset=utf-8" }, "400");
  }

  if (pathname === "/" || pathname === "") return serveIndex(res);

  // 解析到磁盘路径并做穿越防护
  const resolved = path.resolve(ROOT, "." + pathname);
  if (resolved !== ROOT && !resolved.startsWith(ROOT + path.sep)) {
    return send(res, 403, { "Content-Type": "text/plain; charset=utf-8" }, "403");
  }

  const ext = path.extname(pathname);
  // 无扩展名 → 视为前端路由，命中文件则给文件，否则回 index.html
  serveFile(res, resolved, { spa: ext === "" });
});

server.listen(PORT, HOST, () => {
  console.log(`[serve] ${ROOT} → http://${HOST}:${PORT}`);
});
