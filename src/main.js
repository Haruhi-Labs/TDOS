// ═══════════════════════════════════════════════════════════════
// 应用引导：装载全局样式 + 注册路由 + 启动
// 路由（干净 URL，无 .html）：
//   /         主菜单（标题画面）
//   /play     单人 AI 实战
//   /online   在线对战
//   /debug    AI 推演观战
//   /profile  指挥官档案（呼号 + 阵营；出战编队在对战时选）
//   /guide    玩法说明
// 三个游戏模块体量大，按需懒加载（代码分割）。
// ═══════════════════════════════════════════════════════════════

import "../styles.css";
import { initI18n } from "./i18n.js";
import { createRouter } from "./router.js";
import { createAuthGate } from "./auth-gate.js";
import { accountClient } from "./account-client.js";
import { createAnnouncementCenter } from "./announcement-center.js";
import * as menu from "./menu.js";
import * as announcementsView from "./announcements-view.js";
import * as authView from "./auth-view.js";
import * as profileView from "./profile-view.js";
import * as leaderboardView from "./leaderboard-view.js";
import * as guide from "./guide.js";
import * as credits from "./credits.js";

initI18n();

const outlet = document.getElementById("app");

const routes = {
  "/": menu,
  "/announcements": announcementsView,
  "/profile": profileView,
  "/leaderboard": leaderboardView,
  "/guide": guide,
  "/credits": credits,
  "/play": () => import("./solo.js"),
  "/online": () => import("./online.js"),
  "/stellar3v3": async () => {
    const { mountStellar3v3 } = await import("./online.js");
    return { mount: mountStellar3v3 };
  },
  "/stellar3v3/rules": {
    mount(root, context) {
      return guide.mount(root, { ...context, initialTab: "stellar3v3" });
    },
  },
  "/debug": () => import("./debug.js"),
  "/prototype": () => import("./prototype/index.js"),
};

let authGate = null;

const announcementCenter = createAnnouncementCenter({
  client: accountClient,
  onStateChange: (hasUnread) => {
    window.dispatchEvent(new CustomEvent("haruhi:announcement-state", { detail: { hasUnread } }));
  },
});

const router = createRouter({
  routes,
  outlet,
  notFound: menu,
  context: {
    onSignedOut: () => authGate?.signOut(),
  },
});

authGate = createAuthGate({
  root: outlet,
  router,
  authView,
  getMe: () => accountClient.getMe(),
  onAuthenticatedSession: () => announcementCenter.checkForUnread(),
});

// 让各路由模块在需要时也能编程式导航
window.__navigate = router.navigate;

window.addEventListener("haruhi:locale-change", () => {
  router.refresh();
});

authGate.start();
