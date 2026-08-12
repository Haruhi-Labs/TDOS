import assert from "node:assert/strict";
import {
  drawKoizumiBarrier,
  drawKoizumiBarrierImpacts,
  koizumiBarrierVisibleArcs,
} from "../src/battle/render/koizumi-barrier.js";

const TAU = Math.PI * 2;

function createCountingContext() {
  const counts = {
    beginPath: 0,
    stroke: 0,
    fill: 0,
    arc: 0,
    gradient: 0,
    blurredFrames: 0,
    arcRanges: [],
  };
  const context = {
    canvas: { width: 1280, height: 720 },
    getTransform: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }),
    save() {},
    restore() {},
    beginPath() { counts.beginPath += 1; },
    stroke() { counts.stroke += 1; },
    fill() { counts.fill += 1; },
    arc(_x, _y, radius, start, end) {
      counts.arc += 1;
      counts.arcRanges.push([radius, start, end]);
    },
    moveTo() {},
    lineTo() {},
    createRadialGradient() {
      counts.gradient += 1;
      return { addColorStop() {} };
    },
  };
  Object.defineProperty(context, "shadowBlur", {
    set(value) {
      if (Number(value) > 0) {
        counts.blurredFrames += 1;
      }
    },
  });
  return { context, counts };
}

const team = {
  koizumiBarrier: {
    active: true,
    radius: 180,
    recoveryAge: 0,
  },
  ships: {
    main: {
      id: 1,
      alive: true,
      x: 640,
      y: 360,
      vision: 180,
    },
  },
};

const active = createCountingContext();
assert.equal(drawKoizumiBarrier(active.context, team, 2), true, "屏幕内古泉能量圈没有绘制");
assert.equal(active.counts.gradient, 0, "古泉能量圈重新引入了逐帧径向渐变");
assert.equal(active.counts.blurredFrames, 0, "古泉能量圈重新引入了大范围阴影模糊");
assert.ok(active.counts.stroke <= 4, "古泉能量圈的分段没有批量绘制");

const offscreen = createCountingContext();
team.ships.main.x = 2200;
assert.equal(drawKoizumiBarrier(offscreen.context, team, 2), false, "离屏古泉能量圈没有被裁掉");
assert.equal(offscreen.counts.beginPath, 0, "离屏古泉能量圈仍生成了绘制路径");
team.ships.main.x = 640;

const viewerTeam = {
  ships: {
    main: {
      id: 2,
      alive: true,
      x: 940,
      y: 360,
      vision: 160,
      attached: false,
    },
  },
  extraShips: [],
  scouts: [],
  wingmen: [],
  visionWaves: [],
};
const partialArcs = koizumiBarrierVisibleArcs(team, viewerTeam, 2);
assert.ok(partialArcs.length > 0, "己方视野与敌方红圈相交时没有得到可见圆弧");
assert.ok(
  partialArcs.reduce((sum, [start, end]) => sum + end - start, 0) < Math.PI,
  "局部视野意外暴露了敌方完整红圈",
);
const partial = createCountingContext();
assert.equal(
  drawKoizumiBarrier(partial.context, team, 2, { visibleArcs: partialArcs }),
  true,
  "古泉本体不可见时没有绘制视野内的红圈部分",
);
assert.ok(
  partial.counts.arcRanges
    .filter(([radius]) => Math.abs(radius - team.koizumiBarrier.radius) < 1e-6)
    .every(([, start, end]) => end - start < TAU - 1e-6),
  "局部红圈绘制过程中泄露了完整圆周",
);

viewerTeam.ships.main.x = 1200;
const hiddenArcs = koizumiBarrierVisibleArcs(team, viewerTeam, 2);
assert.deepEqual(hiddenArcs, [], "视野没有接触红圈时仍返回了可见圆弧");
const hidden = createCountingContext();
assert.equal(
  drawKoizumiBarrier(hidden.context, team, 2, { visibleArcs: hiddenArcs }),
  false,
  "视野外的敌方红圈仍被绘制",
);
assert.equal(hidden.counts.beginPath, 0, "视野外的敌方红圈仍生成了绘制路径");

viewerTeam.visionWaves.push({
  x: 640,
  y: 360,
  emittedAt: 1,
  speed: 180,
  width: 40,
  expiresAt: 10,
});
assert.deepEqual(
  koizumiBarrierVisibleArcs(team, viewerTeam, 2),
  [[0, TAU]],
  "朝仓的环形真实视野没有显现覆盖到的红圈",
);
viewerTeam.visionWaves.length = 0;

viewerTeam.ships.main.x = 640;
viewerTeam.ships.main.vision = 400;
assert.deepEqual(
  koizumiBarrierVisibleArcs(team, viewerTeam, 2),
  [[0, TAU]],
  "视野完整覆盖红圈时没有显示完整圆周",
);

const impactContext = createCountingContext();
const commonImpact = {
  id: 10,
  teamSeat: "A",
  sourceSeat: "B",
  x: 820,
  y: 360,
  centerX: 640,
  centerY: 360,
  radius: 180,
  angle: 0,
  normalX: 1,
  normalY: 0,
  life: 0.4,
  maxLife: 0.62,
};
drawKoizumiBarrierImpacts(impactContext.context, [
  { ...commonImpact, kind: "projectile" },
  {
    ...commonImpact,
    id: 11,
    kind: "ram",
    ramKind: "koizumi_orb",
    life: 1,
    maxLife: 1.35,
  },
]);
assert.equal(impactContext.counts.gradient, 0, "护盾受击动画重新引入了逐帧径向渐变");
assert.equal(impactContext.counts.blurredFrames, 0, "护盾受击动画重新引入了阴影模糊");
assert.ok(impactContext.counts.stroke <= 10, "护盾受击粒子没有批量绘制");

console.log("古泉旗舰能量圈渲染性能检查通过");
