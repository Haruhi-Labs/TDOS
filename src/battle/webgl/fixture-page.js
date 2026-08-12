import { createNativeBattleRenderer } from "../native-webgl-renderer.js";
import { renderNativeBattleVisualFixture } from "../native-webgl-visual-fixture.js";

const params = new URLSearchParams(window.location.search);
const mode = params.get("renderer") || "webgl2";
const canvas = document.querySelector("#fixtureCanvas");
const renderer = createNativeBattleRenderer(canvas, { forceMode: mode });
const ctx = renderer.ctx;
function renderFixture() {
  renderer.beginFrame();
  ctx.setTransform(canvas.width / 1440, 0, 0, canvas.height / 1440, 0, 0);
  renderNativeBattleVisualFixture(ctx);
  renderer.present();
}
renderFixture();
window.__HARUHI_FIXTURE_READY__ = true;
window.__HARUHI_FIXTURE_RENDERER__ = renderer.mode;
window.__HARUHI_FIXTURE_STATS__ = renderer.getStats();
window.__HARUHI_RENDER_FIXTURE__ = renderFixture;
