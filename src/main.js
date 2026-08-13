// ═══════════════════════════════════════════════════════════════
// 应用引导：装载全局样式 + 注册路由 + 启动
// 路由（干净 URL，无 .html）：
//   /         主菜单（标题画面）
//   /play     单人 AI 实战
//   /online   在线对战
//   /debug    AI 推演观战
//   /profile  指挥官档案（呼号 + 阵营；出战编队在对战时选）
//   /guide    玩法说明
//   /changelog 公共更新日志
//   /statistics 公开阵容胜率统计
// 三个游戏模块体量大，按需懒加载（代码分割）。
// ═══════════════════════════════════════════════════════════════

import "../styles.css";
import { initI18n } from "./i18n.js";
import { installInteractionFeedback } from "./interaction-feedback.js";
import { createRouter } from "./router.js";
import * as menu from "./menu.js";
import * as profileView from "./profile-view.js";
import * as guide from "./guide.js";
import * as credits from "./credits.js";
import * as authCallback from "./auth-callback.js";
import { refreshGameIdentity } from "./identity.js";

initI18n();
installInteractionFeedback();

const outlet = document.getElementById("app");

const routes = {
  "/": menu,
  "/profile": profileView,
  "/guide": guide,
  "/changelog": () => import("./changelog.js"),
  "/statistics": () => import("./statistics.js"),
  "/credits": credits,
  "/auth/callback": authCallback,
  "/play": () => import("./solo.js"),
  "/play/tutorial": () => import("./solo.js"),
  "/online": () => import("./online.js"),
  "/debug": () => import("./debug.js"),
};

const router = createRouter({
  routes,
  outlet,
  notFound: menu,
});

// 让各路由模块在需要时也能编程式导航
window.__navigate = router.navigate;

window.addEventListener("haruhi:locale-change", () => {
  router.refresh();
});

// 身份探测不参与首屏门槛；失败时状态层会静默落回游客身份。
void refreshGameIdentity();
router.start();
