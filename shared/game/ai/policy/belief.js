// 情报占据图：推理敌人可能的位置，用于搜索与侦察选点。
// 这些方法安装在 RulePolicy 的原型上，经 this 访问观测、参数、随机流与策略状态。
import { clamp, distance } from "../../math.js";

export const beliefMethods = {
  // ── 情报占据图(belief)：类人地推理"敌人可能在哪" ──
  initBelief(enemyMain) {
    const ws = this.obs.world.size;
    const cols = 16;
    const rows = 16;
    const belief = { cols, rows, cell: ws / cols, w: new Float64Array(cols * rows) };
    if (enemyMain) {
      belief.w[this.beliefIdxFor(belief, enemyMain.x, enemyMain.y)] = 1;
    }
    return belief;
  },

  beliefIdxFor(b, x, y) {
    const cx = clamp(Math.floor(x / b.cell), 0, b.cols - 1);
    const cy = clamp(Math.floor(y / b.cell), 0, b.rows - 1);
    return cy * b.cols + cx;
  },

  // 该点是否在我方任一视野源覆盖内(用于"只采信我方能看见的间接情报",保持公平)
  perceivesPoint(x, y) {
    for (const src of this.obs.self.visionSources) {
      if (distance(x, y, src.x, src.y) <= src.range) return true;
    }
    return false;
  },

  // 每tick更新：①看见→坍缩到可见处；否则 ②预测(向四邻扩散) ③排除(己方视野看过且无敌的区清零)
  // ④间接情报(敌子弹/侦察机反推) ⑤兜底重播种
  updateBelief(dt) {
    const b = this.belief;
    if (!b) return;
    const { cols, rows, cell } = b;
    const n = cols * rows;

    const visible = [];
    for (const s of this.obs.enemy.visible) {
      if (s.kind === "ship") visible.push(s);
    }
    if (visible.length) {
      // 坍缩：看得见就把概率集中到可见位置(清掉旧弥散)
      b.w.fill(0);
      for (const s of visible) b.w[this.beliefIdxFor(b, s.x, s.y)] = 1;
      return;
    }

    // ① 预测：敌可能已移动→概率按"敌最大速度×dt"向四邻扩散
    const enemyMaxSpeed = 46;
    const leak = clamp((enemyMaxSpeed * Math.max(dt, 0)) / Math.max(cell, 1), 0, 0.22);
    let w = b.w;
    if (leak > 0.0008) {
      const next = new Float64Array(n);
      for (let cy = 0; cy < rows; cy++) {
        for (let cx = 0; cx < cols; cx++) {
          const i = cy * cols + cx;
          const v = w[i];
          if (v <= 1e-9) continue;
          const nb = [];
          if (cx > 0) nb.push(i - 1);
          if (cx < cols - 1) nb.push(i + 1);
          if (cy > 0) nb.push(i - cols);
          if (cy < rows - 1) nb.push(i + cols);
          const out = v * leak;
          next[i] += v - out;
          const share = out / Math.max(1, nb.length);
          for (const j of nb) next[j] += share;
        }
      }
      b.w = next;
      w = next;
    }

    // ② 排除：己方每个视野源覆盖到的cell若无敌→几乎清零(看过、是空的)
    for (const src of this.obs.self.visionSources) {
      const r = src.range;
      if (!(r > 0)) continue;
      const minx = clamp(Math.floor((src.x - r) / cell), 0, cols - 1);
      const maxx = clamp(Math.floor((src.x + r) / cell), 0, cols - 1);
      const miny = clamp(Math.floor((src.y - r) / cell), 0, rows - 1);
      const maxy = clamp(Math.floor((src.y + r) / cell), 0, rows - 1);
      for (let cy = miny; cy <= maxy; cy++) {
        for (let cx = minx; cx <= maxx; cx++) {
          const ccx = (cx + 0.5) * cell;
          const ccy = (cy + 0.5) * cell;
          if (distance(src.x, src.y, ccx, ccy) <= r + cell * 0.3) {
            w[cy * cols + cx] *= 0.04;
          }
        }
      }
    }

    // ── 间接情报(很关键:敌舰本体多数时间在视野外，靠"看到的子弹/敌侦察机"反推敌方范围) ──
    // noIndirectIntel=true 时整体跳过(用于控制变量对照实验)
    if (this.params.features.indirectIntel) {
      // (a) 敌方子弹:朝我方飞来→开火的敌舰在其"逆飞行方向"、射程之内。只用我方能感知到的子弹(公平)。
      {
        for (const p of this.obs.enemy.projectiles) {
          const vx = p.targetX - p.x;
          const vy = p.targetY - p.y;
          const vl = Math.hypot(vx, vy);
          if (vl < 1) continue;
          const bx = -vx / vl;
          const by = -vy / vl; // 指向开火舰
          for (const seg of [[130, 0.4], [280, 0.6], [430, 0.4]]) {
            w[this.beliefIdxFor(b, p.x + bx * seg[0], p.y + by * seg[0])] += seg[1];
          }
        }
      }
      // (b) 敌方侦察机:区分两类,避免被长门"一圈侦察机"误导——
      //   · burst(长门分舰技):一圈(16架)围着发射舰orbit,逐个回溯方向会被环切线带偏、且落点成一圈
      //     (峰偏到环上而非中心)。正确读法=一圈侦察机的"质心"≈敌舰所在 → 只在质心加权,不逐个回溯。
      //   · 普通(transit):单架从敌舰飞向战区,逆其朝向≈发射处有敌舰 → 回溯加权。
      let bx0 = 0;
      let by0 = 0;
      let bn = 0;
      for (const sc of this.obs.enemy.visible) {
        if (sc.kind !== "scout") continue;
        if (sc.pattern === "burst") {
          bx0 += sc.x; by0 += sc.y; bn++;
          continue; // burst 不逐个回溯(会误导),留到下面按质心处理
        }
        const ang = Number.isFinite(sc.angle) ? sc.angle : 0;
        w[this.beliefIdxFor(b, sc.x - Math.cos(ang) * 240, sc.y - Math.sin(ang) * 240)] += 0.35;
        w[this.beliefIdxFor(b, sc.x, sc.y)] += 0.18;
      }
      if (bn >= 3) {
        // 看到≥3架一圈侦察机→敌舰在它们质心附近(一圈对称,质心≈圆心=发射舰)。这是很强的情报,给高权重。
        w[this.beliefIdxFor(b, bx0 / bn, by0 / bn)] += 1.3;
      }
    }

    // “猫爪印记”的标记本来就持续显示精确位置，因此可以形成一个精确搜索峰；它仍不把
    // 其它敌人或目标属性写入情报。长门雷达则只注入带误差的接触。
    for (const stored of this.enemyIntel.entities.values()) {
      if (stored.source !== "hunt") continue;
      w[this.beliefIdxFor(b, stored.x, stored.y)] += 2.4;
    }

    // 长门雷达只把带误差的接触注入占据图，不会像真实视野一样把概率坍缩到真值。
    // 模糊接触铺得更宽，近距离高置信接触则形成更集中的搜索峰。
    for (const stored of this.enemyIntel.entities.values()) {
      if (stored.source !== "radar") continue;
      const contact = this.projectContact(stored, 1.2);
      if (!contact || contact.age > 9 || contact.confidence < 0.1) continue;
      const sigma = Math.max(cell * 0.65, contact.uncertainty * 0.62);
      const radiusCells = clamp(Math.ceil((sigma * 2.2) / cell), 1, 4);
      const centerX = clamp(Math.floor(contact.x / cell), 0, cols - 1);
      const centerY = clamp(Math.floor(contact.y / cell), 0, rows - 1);
      for (let oy = -radiusCells; oy <= radiusCells; oy += 1) {
        for (let ox = -radiusCells; ox <= radiusCells; ox += 1) {
          const cx = centerX + ox;
          const cy = centerY + oy;
          if (cx < 0 || cx >= cols || cy < 0 || cy >= rows) continue;
          const px = (cx + 0.5) * cell;
          const py = (cy + 0.5) * cell;
          const d = distance(px, py, contact.x, contact.y);
          const weight = Math.exp(-(d * d) / Math.max(2 * sigma * sigma, 1));
          w[cy * cols + cx] += weight * contact.confidence * 0.34;
        }
      }
    }

    // ③ 兜底：若几乎全被排除(敌一定还在地图某处)→铺一层弱先验，以最后已知/出生点加权，保持有处可搜
    let total = 0;
    for (let i = 0; i < n; i++) total += w[i];
    if (total < 0.04) {
      for (let i = 0; i < n; i++) w[i] += 0.015;
      const seed = this.enemyIntel?.main;
      if (seed && Number.isFinite(seed.x)) w[this.beliefIdxFor(b, seed.x, seed.y)] += 0.4;
    }
  },

  // 最高概率(且未排除)区域的中心——下一步该去搜/侦察的地方
  beliefPeak() {
    const b = this.belief;
    if (!b) return null;
    let best = -1;
    let bi = -1;
    for (let i = 0; i < b.w.length; i++) {
      if (b.w[i] > best) { best = b.w[i]; bi = i; }
    }
    if (bi < 0 || best <= 1e-6) return null;
    const cx = bi % b.cols;
    const cy = Math.floor(bi / b.cols);
    return { x: (cx + 0.5) * b.cell, y: (cy + 0.5) * b.cell, weight: best };
  },

  beliefZoneWeights() {
    const weights = new Map(this.obs.world.zones.map((zone) => [zone.id, 0]));
    const belief = this.belief;
    if (!belief) return weights;
    for (let index = 0; index < belief.w.length; index += 1) {
      const col = index % belief.cols;
      const row = Math.floor(index / belief.cols);
      const x = (col + 0.5) * belief.cell;
      const y = (row + 0.5) * belief.cell;
      const zone = this.zoneForPoint(x, y);
      weights.set(zone.id, (weights.get(zone.id) || 0) + belief.w[index]);
    }
    return weights;
  },
};
