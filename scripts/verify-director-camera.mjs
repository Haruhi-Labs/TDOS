import assert from "node:assert/strict";
import { createDirectorCamera } from "../src/battle/director-camera.js";
import { createBattleCamera } from "../src/battle/camera.js";

const focus = { x: 1008, y: 432 };
const worldAt = (view, point) => ({ x: view.left + point.x / view.zoom, y: view.top + point.y / view.zoom });
function near(actual, expected, message, epsilon = 1e-7) {
  assert.ok(Math.abs(actual - expected) < epsilon, `${message}：${actual} / ${expected}`);
}
function inside(view) {
  assert.ok(view.left >= -1e-7 && view.top >= -1e-7 && view.left + view.width <= 1440 + 1e-7 && view.top + view.height <= 1440 + 1e-7, "镜头超出战场边界");
}

const views = [];
for (const hz of [30, 60, 144]) {
  const camera = createDirectorCamera();
  camera.update(0);
  const original = camera.view();
  camera.setZoom(2, focus);
  assert.deepEqual(camera.view(), original, "输入事件直接改变画面，未经过平滑推进");
  for (let frame = 1; frame <= hz; frame += 1) {
    const before = camera.zoom;
    camera.update(frame * 1000 / hz);
    assert.ok(camera.zoom > before && camera.zoom < 2, "缩放过程不连续或出现回弹");
    const point = worldAt(camera.view(), focus);
    near(point.x, focus.x, "缩放期间鼠标下的世界横坐标漂移");
    near(point.y, focus.y, "缩放期间鼠标下的世界纵坐标漂移");
    inside(camera.view());
  }
  views.push(camera.view());
}
for (const view of views.slice(1)) {
  near(view.zoom, views[0].zoom, "不同刷新率的缩放响应不同");
  near(view.left, views[0].left, "不同刷新率的平移响应不同");
}

const camera = createDirectorCamera();
camera.update(0);
camera.setZoom(3);
camera.update(50);
const moving = camera.view();
camera.setZoom(1.2);
assert.deepEqual(camera.view(), moving, "连续反向滚轮造成画面跳变");
camera.update(66);
assert.ok(camera.zoom < moving.zoom && camera.zoom > 1.2, "反向输入没有平滑接管镜头");
camera.setZoom(2);
for (let time = 82; time < 2082; time += 16) camera.update(time);
const beforePan = camera.view();
camera.beginPan();
camera.panBy(200, -100);
assert.deepEqual(camera.view(), beforePan, "拖拽事件直接跳动镜头");
camera.update(2098);
assert.ok(camera.view().left < beforePan.left && camera.view().top > beforePan.top, "拖拽方向与抓住画面移动的方向不一致");
assert.ok(camera.view().left > beforePan.left - 100, "拖拽没有平滑过渡");
camera.endPan();
for (let time = 2114; time < 4114; time += 16) camera.update(time);
near(camera.view().left, beforePan.left - 100, "松手后没有收敛到所选构图", 1e-4);
camera.beginPan();
camera.panBy(1e6, -1e6);
for (let time = 4114; time < 4500; time += 16) { camera.update(time); inside(camera.view()); }
camera.endPan();
camera.setZoom(1);
for (let time = 4500; time < 6500; time += 16) { camera.update(time); inside(camera.view()); }
near(camera.view().left, 0, "回到全图时没有平滑居中", 1e-4);
near(camera.zoom, 1, "回到全图时没有恢复原始倍率", 1e-4);
camera.setZoom(100);
assert.equal(camera.targetZoom, 4, "没有限制导演镜头的最大倍率");
camera.update(20000);
assert.ok(camera.zoom < 4, "长时间暂停后镜头直接跳到目标");
camera.reset();
assert.equal(camera.zoom, 1);
assert.equal(camera.dragging, false);

const reduced = createDirectorCamera({ reducedMotion: () => true });
reduced.setZoom(2, focus);
reduced.update(0);
assert.equal(reduced.zoom, 2, "减少动态效果模式仍播放移动动画");

// 同一共享入口切换观战/玩家模式，玩家原有即时缩放与上限保持一致。
globalThis.window = { matchMedia: () => ({ matches: false }) };
let spectating = false;
const facade = createBattleCamera({ canvas: { getBoundingClientRect: () => ({ left: 0, top: 0, width: 720, height: 720 }) }, isMobile: () => false, directorMode: () => spectating });
facade.setCameraZoom(2);
assert.equal(facade.currentViewState().zoom, 2, "玩家镜头被改为观战动画");
assert.equal(facade.maxZoom, 2.6, "玩家缩放上限被观战镜头改写");
spectating = true;
facade.reset();
assert.equal(facade.effectiveViewZoom(4), 4, "观战有效视野倍率仍被玩家上限截断");
const wheel = { deltaY: -120, deltaMode: 0, clientX: 360, clientY: 360 };
facade.zoomByWheel(wheel);
near(facade.targetZoom, Math.exp(0.216), "像素滚轮没有采用连续倍率");
assert.equal(facade.zoom, 1, "滚轮绕过了动画推进");
facade.reset();
facade.zoomByWheel({ ...wheel, deltaY: -7.5, deltaMode: 1 });
near(facade.targetZoom, Math.exp(0.216), "行单位滚轮没有统一为像素");
assert.equal(facade.zoomByWheel({ ...wheel, deltaY: 0 }), false, "零滚轮输入改变了镜头");
console.log("导演镜头检查通过：鼠标锚点、连续缩放与反向接管、阻尼平移、帧率一致性、边界、复位、减少动态效果与玩家模式隔离。");
