// ═══════════════════════════════════════════════════════════════

import { t } from "./i18n.js";
// 极简 History 路由器
// · 干净 URL（/play、/online …），无 .html 后缀。
// · 每个路由是一个「可挂载模块」：导出 mount(root, ctx) → 可选 unmount()。
// · 切换路由时先卸载上一个（停 rAF、断 socket、移除监听），再挂载下一个，
//   避免多个游戏循环/网络连接泄漏并存。
// · 拦截站内 <a href="/..."> 点击走 pushState；支持浏览器前进/后退。
// · base 感知：线上挂在 /test-game/ 子路径下时，内部一律用「应用路径」
//   (/、/play …)，与 location.pathname 间靠 toAppPath/toUrlPath 剥离/拼接
//   base，保证导航、刷新、前进后退都不会逃出子路径。本地 dev base 为 /。
// ═══════════════════════════════════════════════════════════════

// 部署 base（Vite 注入）：本地 dev 为 "/"，线上构建为 "/test-game/"。
const RAW_BASE = import.meta.env.BASE_URL || "/"; // "/" 或 "/test-game/"
const BASE = RAW_BASE.replace(/\/+$/, ""); // "" 或 "/test-game"

// location.pathname → 应用路径（剥掉 base 前缀）
function toAppPath(pathname) {
  let p = pathname || "/";
  if (BASE && (p === BASE || p.startsWith(BASE + "/"))) {
    p = p.slice(BASE.length) || "/";
  }
  if (!p.startsWith("/")) p = "/" + p;
  return p;
}

// 应用路径 → 完整 URL 路径（拼上 base）
function toUrlPath(appPath) {
  if (!appPath || appPath === "/") return RAW_BASE; // "/" 或 "/test-game/"
  return BASE + appPath; // "/play" 或 "/test-game/play"
}

export function createRouter({ routes, outlet, notFound, onNavigate }) {
  let teardown = null; // 当前路由的卸载函数
  let token = 0; // 防止异步挂载竞态（快速连点）

  async function loadModule(entry) {
    // entry 可以是模块对象（含 mount），或返回 Promise<模块> 的函数（懒加载）
    const mod = typeof entry === "function" ? await entry() : entry;
    return mod && mod.default && mod.default.mount ? mod.default : mod;
  }

  async function render(path) {
    const myToken = ++token;
    const entry = routes[path] || notFound;

    // 卸载上一个路由
    if (teardown) {
      try {
        teardown();
      } catch (error) {
        console.error("[router] unmount error:", error);
      }
      teardown = null;
    }
    outlet.innerHTML = "";

    let mod;
    try {
      mod = await loadModule(entry);
    } catch (error) {
      console.error("[router] failed to load route", path, error);
      outlet.innerHTML = `<div class="boot-splash">${t("页面加载失败")}</div>`;
      return;
    }
    if (myToken !== token) return; // 期间又导航了，放弃

    if (typeof onNavigate === "function") onNavigate(path);
    const result = await mod.mount(outlet, { navigate });
    if (myToken !== token) {
      // 挂载完成时已切走，立即卸载
      if (typeof result === "function") result();
      return;
    }
    teardown = typeof result === "function" ? result : null;
  }

  // path 为应用路径（/、/play …），对外（含 window.__navigate）统一用此约定
  function navigate(path, { replace = false } = {}) {
    const url = toUrlPath(path);
    if (url === location.pathname) return;
    if (replace) history.replaceState({}, "", url);
    else history.pushState({}, "", url);
    render(path);
  }

  function onClick(event) {
    if (event.defaultPrevented || event.button !== 0) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const anchor = event.target.closest("a");
    if (!anchor) return;
    const href = anchor.getAttribute("href");
    if (!href || !href.startsWith("/")) return; // 外链 / 锚点 / 协议链接
    if (anchor.target === "_blank" || anchor.hasAttribute("download")) return;
    event.preventDefault();
    navigate(href);
  }

  function start() {
    document.addEventListener("click", onClick);
    window.addEventListener("popstate", () =>
      render(toAppPath(location.pathname)),
    );
    render(toAppPath(location.pathname));
  }

  function refresh() {
    render(toAppPath(location.pathname));
  }

  return { start, navigate, refresh };
}
