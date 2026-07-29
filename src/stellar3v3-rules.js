import { STELLAR_TERRITORY_DEFAULT_PARAMETERS } from "../shared/modes/stellar-territory.js";
import { TERRAIN_MOVEMENT_MULTIPLIERS } from "../shared/gameplay/territory-terrain.js";
import { startStarfield } from "./starfield.js";
import { getLocale } from "./i18n.js";
import { mountRouteFluidBackdrop } from "./effects/fluid-reveal/routeBackdrop.js";

const COPY = Object.freeze({
  zh: {
    eyebrow: "STELLAR TERRITORY / 3V3 BRIEFING",
    title: "星域争夺",
    subtitle: "三路推进，守住战争点。每一次分兵、夺点与撤退，都会改变整支舰队的战局。",
    back: "返回 3v3 大厅",
    begin: "进入 3v3 大厅",
    mapLabel: "三路战区",
    mapCaption: "上路 / 中路 / 下路各有一个控制区，障碍会改变航线，不会阻断战场选择。",
    objectives: [
      ["胜利条件", "让敌方战争点归零即可获胜；控制区优势会持续消耗落后方的战争点。"],
      ["占领控制区", "单方舰船进入即可开始占领；敌我同时在场会使据点进入争夺并暂停推进。"],
      ["阵亡与复活", "舰船阵亡会扣除阵营战争点并进入复活队列。主舰代价更高，全灭还会受到额外惩罚。"],
      ["资源与战术技能", "争夺资源与技能包来补充战力；拾取的战术技能由阵营共享，需要把握释放时机。"],
    ],
    loopTitle: "战局循环",
    loop: [
      ["01", "展开", "开局分配上、中、下三路，先确认队友的目标。"],
      ["02", "夺取", "利用掩体和地形争夺控制区，形成据点数量优势。"],
      ["03", "压制", "优势会转化为持续战争点压力；击毁敌舰可进一步拉开差距。"],
      ["04", "重整", "阵亡后会在出生区复活。保住战争点，等待队友会合再出击。"],
    ],
    terrainTitle: "航道与地形",
    terrain: {
      speed: ["高速航道", "顺向航行提升速度与加速，逆向会减速。编队以移动领舰所在位置判定效果。"],
      asteroid: ["小行星带", "降低速度、加速和转向。适合伏击，也会拖慢撤退。"],
      mire: ["引力泥沼", "大幅降低速度和转向。不要在这里与敌人长时间缠斗。"],
    },
    controlsTitle: "基本操作",
    controls: [
      ["右键", "为当前舰队设定航线；系统会自动避开障碍。"],
      ["拖曳空白处", "移动镜头，观察三条航线与队友位置。"],
      ["滚轮", "缩放镜头；小地图可快速确认战局分布。"],
      ["分离副舰", "以独立舰队执行边线牵制、支援或侦察。"],
    ],
    initialTickets: "初始战争点",
    captureTime: "基础占领",
    controlPoints: "控制区",
    seconds: "秒",
  },
  en: {
    eyebrow: "STELLAR TERRITORY / 3V3 BRIEFING",
    title: "Stellar Territory",
    subtitle: "Advance across three lanes and protect your tickets. Every split, capture, and retreat changes the battle.",
    back: "Back to 3v3 Lobby",
    begin: "Enter 3v3 Lobby",
    mapLabel: "Three-lane theater",
    mapCaption: "Top, middle, and bottom each contain a control point. Obstacles reshape routes, not your strategic choices.",
    objectives: [
      ["Victory", "Win by reducing the enemy alliance's tickets to zero. A control-point lead steadily drains the trailing side."],
      ["Capture points", "An uncontested alliance starts capture. When both sides are present, the point is contested and progress pauses."],
      ["Losses and respawns", "A destroyed ship costs alliance tickets and enters the respawn queue. Flagships cost more, and a full wipe adds a penalty."],
      ["Resources and tactical skills", "Contest resource and skill packages for strength. Collected tactical skills are shared by the alliance, so timing matters."],
    ],
    loopTitle: "Battle rhythm",
    loop: [
      ["01", "Deploy", "Assign top, middle, and bottom lanes, then confirm your team's first objectives."],
      ["02", "Capture", "Use cover and terrain to take control points and create a numbers advantage."],
      ["03", "Pressure", "A lead drains enemy tickets; destroying ships widens the gap further."],
      ["04", "Regroup", "Respawn at base, protect your remaining tickets, and return together."],
    ],
    terrainTitle: "Lanes and terrain",
    terrain: {
      speed: ["Speed lane", "Forward travel increases speed and acceleration; reverse travel slows you. Attached fleets use the movement leader's position."],
      asteroid: ["Asteroid belt", "Reduces speed, acceleration, and turn rate. Useful for ambushes but risky for retreat."],
      mire: ["Gravity mire", "Greatly reduces speed and turning. Avoid prolonged fights inside it."],
    },
    controlsTitle: "Core controls",
    controls: [
      ["Right click", "Set a route for the active fleet. The system plans around obstacles."],
      ["Drag empty space", "Pan the camera to follow every lane and your allies."],
      ["Mouse wheel", "Zoom the camera; use the minimap to read the front line."],
      ["Split sub-ships", "Create independent fleets for side-lane pressure, support, or scouting."],
    ],
    initialTickets: "Starting tickets",
    captureTime: "Base capture",
    controlPoints: "Control points",
    seconds: "sec",
  },
  ja: {
    eyebrow: "STELLAR TERRITORY / 3V3 BRIEFING",
    title: "星域争夺",
    subtitle: "3レーンを進み、戦争点数を守り抜け。分離、制圧、撤退のすべてが戦局を変える。",
    back: "3v3 ロビーへ戻る",
    begin: "3v3 ロビーへ",
    mapLabel: "3レーン戦域",
    mapCaption: "上・中・下レーンに制圧区が一つずつある。障害物は航路を変えるが、戦略の選択肢は奪わない。",
    objectives: [
      ["勝利条件", "敵陣営の戦争点数をゼロにすれば勝利。制圧区の優位は劣勢側の点数を継続的に減らす。"],
      ["制圧区", "単独陣営が入れば制圧を開始。両陣営がいる間は争奪状態となり、進行は止まる。"],
      ["撃沈と復活", "艦が撃沈されると陣営の戦争点数を失い、復活待機に入る。旗艦はより高コストで、全滅には追加ペナルティがある。"],
      ["資源と戦術スキル", "資源とスキルパックを奪い、戦力を補充する。回収した戦術スキルは陣営で共有される。"],
    ],
    loopTitle: "戦局の流れ",
    loop: [
      ["01", "展開", "上・中・下レーンを分担し、味方の初動目標を確認する。"],
      ["02", "制圧", "遮蔽物と地形を使い、制圧区の数で優位を作る。"],
      ["03", "圧力", "制圧区の優位は敵の戦争点数を減らす。敵艦の撃沈で差を広げる。"],
      ["04", "再編", "出撃地点で復活し、残りの戦争点数を守って味方と再合流する。"],
    ],
    terrainTitle: "航路と地形",
    terrain: {
      speed: ["高速航路", "順方向では速度と加速が上がり、逆方向では減速する。編隊は移動リーダーの位置で判定される。"],
      asteroid: ["小惑星帯", "速度、加速、旋回を下げる。待ち伏せには有効だが、撤退も遅くなる。"],
      mire: ["重力泥沼", "速度と旋回を大きく下げる。長時間の交戦は避けよう。"],
    },
    controlsTitle: "基本操作",
    controls: [
      ["右クリック", "選択中の艦隊へ航路を設定する。障害物は自動で回避される。"],
      ["空白をドラッグ", "カメラを動かし、3レーンと味方の位置を確認する。"],
      ["ホイール", "カメラを拡大・縮小する。ミニマップで前線を確認する。"],
      ["副艦を分離", "サイドレーンの牽制、支援、偵察に独立艦隊を使う。"],
    ],
    initialTickets: "初期戦争点数",
    captureTime: "基本制圧時間",
    controlPoints: "制圧区",
    seconds: "秒",
  },
});

function localizedCopy() {
  return COPY[getLocale()] || COPY.zh;
}

function signedPercent(multiplier) {
  const percentage = Math.round((Number(multiplier) - 1) * 100);
  return `${percentage > 0 ? "+" : ""}${percentage}%`;
}

function terrainFacts(copy) {
  const speed = TERRAIN_MOVEMENT_MULTIPLIERS.speed_lane;
  const asteroid = TERRAIN_MOVEMENT_MULTIPLIERS.asteroid_belt;
  const mire = TERRAIN_MOVEMENT_MULTIPLIERS.gravity_mire;
  return [
    { tone: "speed", title: copy.terrain.speed[0], body: copy.terrain.speed[1], value: `${signedPercent(speed.forwardSpeedMultiplier)} / ${signedPercent(speed.reverseSpeedMultiplier)}` },
    { tone: "asteroid", title: copy.terrain.asteroid[0], body: copy.terrain.asteroid[1], value: `${signedPercent(asteroid.speedMultiplier)} SPD` },
    { tone: "mire", title: copy.terrain.mire[0], body: copy.terrain.mire[1], value: `${signedPercent(mire.speedMultiplier)} SPD` },
  ];
}

function template() {
  const copy = localizedCopy();
  const defaults = STELLAR_TERRITORY_DEFAULT_PARAMETERS;
  const objectiveCards = copy.objectives.map(([title, body], index) => `
    <article class="stellar-rules-card">
      <span class="stellar-rules-index">0${index + 1}</span>
      <h2>${title}</h2>
      <p>${body}</p>
    </article>
  `).join("");
  const loop = copy.loop.map(([number, title, body]) => `
    <li><span>${number}</span><div><strong>${title}</strong><p>${body}</p></div></li>
  `).join("");
  const terrain = terrainFacts(copy).map((item) => `
    <article class="stellar-terrain-card ${item.tone}">
      <span>${item.value}</span>
      <h2>${item.title}</h2>
      <p>${item.body}</p>
    </article>
  `).join("");
  const controls = copy.controls.map(([key, body]) => `
    <div class="stellar-rules-control"><kbd>${key}</kbd><span>${body}</span></div>
  `).join("");

  return `
    <section class="page-stage stellar-rules-page">
      <canvas class="page-stars" aria-hidden="true"></canvas>
      <div class="page-bg" aria-hidden="true"></div>
      <div class="page-frame page-frame-wide stellar-rules-frame">
        <a class="page-back" href="/stellar3v3">${copy.back}</a>
        <div class="page-scroll stellar-rules-scroll">
          <header class="stellar-rules-hero">
            <p>${copy.eyebrow}</p>
            <h1>${copy.title}<span>3v3</span></h1>
            <div class="stellar-rules-rule" aria-hidden="true"></div>
            <p class="stellar-rules-lede">${copy.subtitle}</p>
          </header>

          <section class="stellar-rules-command" aria-label="${copy.mapLabel}">
            <div class="stellar-rules-map" aria-hidden="true">
              <i class="lane lane-top"></i><i class="lane lane-mid"></i><i class="lane lane-bottom"></i>
              <b class="point point-top"></b><b class="point point-mid"></b><b class="point point-bottom"></b>
              <em class="base base-a"></em><em class="base base-b"></em>
            </div>
            <div class="stellar-rules-command-copy">
              <p class="stellar-rules-kicker">${copy.mapLabel}</p>
              <h2>${copy.mapCaption}</h2>
              <dl class="stellar-rules-stats">
                <div><dt>${defaults.initialTickets}</dt><dd>${copy.initialTickets}</dd></div>
                <div><dt>${defaults.captureSeconds} ${copy.seconds}</dt><dd>${copy.captureTime}</dd></div>
                <div><dt>3</dt><dd>${copy.controlPoints}</dd></div>
              </dl>
            </div>
          </section>

          <section class="stellar-rules-grid">${objectiveCards}</section>

          <section class="stellar-rules-section">
            <p class="stellar-rules-kicker">TACTICAL SEQUENCE</p>
            <h2>${copy.loopTitle}</h2>
            <ol class="stellar-rules-loop">${loop}</ol>
          </section>

          <section class="stellar-rules-section">
            <p class="stellar-rules-kicker">MOVEMENT ENVIRONMENT</p>
            <h2>${copy.terrainTitle}</h2>
            <div class="stellar-terrain-grid">${terrain}</div>
          </section>

          <section class="stellar-rules-section stellar-rules-controls-section">
            <p class="stellar-rules-kicker">COMMAND INPUT</p>
            <h2>${copy.controlsTitle}</h2>
            <div class="stellar-rules-controls">${controls}</div>
          </section>

          <a class="stellar-rules-enter" href="/stellar3v3">${copy.begin}</a>
        </div>
      </div>
    </section>
  `;
}

export function mount(root) {
  root.innerHTML = template();
  const starfieldAbort = new AbortController();
  startStarfield(root.querySelector(".page-stars"), starfieldAbort.signal);
  const fluidBackdrop = mountRouteFluidBackdrop(root.querySelector(".stellar-rules-page"), {
    logLabel: "Stellar 3v3 rules fluid backdrop",
    onReady: () => starfieldAbort.abort(),
  });
  return () => {
    fluidBackdrop.destroy();
    starfieldAbort.abort();
  };
}
