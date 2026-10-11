// 情报记忆：带反应延迟地吸收可见实体、雷达接触与猎杀标记，并把旧情报外推成当前估计。
// 情报组件独占接触记录和待确认队列；策略只接收不可变记录及搜索区域通知。
import { copyPlainData, freezePlainData } from "../../../../data/plain-data.js";
import { CHARACTER_DEFS } from "../../../characters/catalog.js";
import { TICK_DT } from "../../../foundation/constants.js";
import { zoneContains, clamp } from "../../../foundation/math.js";

export class IntelTracker {
  #port;
  #entities = new Map();
  #main;
  #pending = new Map();
  #projectionObservation;
  #projectionParams;
  #projections = new WeakMap();
  constructor(port, enemyMain) {
    this.#port = port;
    this.#main = Object.freeze({
      id: enemyMain.id, kind: "ship", key: enemyMain.key, slotKey: enemyMain.slotKey,
      x: enemyMain.x, y: enemyMain.y, angle: enemyMain.angle, speed: 0,
      seenAt: this.obs.time, zoneId: this.zoneForPoint(enemyMain.x, enemyMain.y).id, source: "spawn",
    });
  }
  get obs() { return this.#port.observe(); }
  get params() { return this.#port.parameters().params; }
  get profile() { return this.#port.parameters().profile; }
  get reactionMult() { return this.#port.parameters().reactionMult; }
  get main() { return this.#main; }
  get contacts() { return Object.freeze([...this.#entities.values()]); }
  get pendingCount() { return this.#pending.size; }
  get contactCount() { return this.#entities.size; }
  zoneForPoint(x, y) { return this.obs.world.zones.find((zone) => zoneContains(zone, x, y)) || this.obs.world.zones[4]; }
  safeRoutePadding() { return clamp(this.obs.world.size * 0.08, 90, 145); }
  stableNoise(seed, salt = 0) {
    const value = Math.sin(seed * 12.9898 + salt * 78.233 + 0.9157) * 43758.5453;
    return value - Math.floor(value);
  }
  #store(snapshot, trackMain = false) {
    snapshot = freezePlainData(copyPlainData(snapshot));
    this.#entities.set(snapshot.id, snapshot);
    if (trackMain && snapshot.slotKey === "main") this.#main = snapshot;
    this.#port.contactZone(snapshot.zoneId);
  }

  perceptionDelayFor(entity) {
    const P = this.params.perception;
    const base = entity.kind === "ship" ? P.shipDelay : entity.kind === "wingman" ? P.wingmanDelay : P.otherDelay;
    const roleBias = entity.slotKey === "main" ? P.mainBias : 0;
    const jitter = this.stableNoise(entity.id, 3) * P.jitter;
    const mult = this.reactionMult || 1; // 难度:放大反应时间(感知延迟),不改任何能力
    return clamp(
      (base + roleBias + jitter) * this.profile.reactionScale * mult,
      this.profile.reactionMin * mult,
      this.profile.reactionMax * mult,
    );
  }

  queueSighting(entity) {
    const snapshot = this.snapshotEnemyContact(entity, "visible");
    const now = this.obs.time;
    const pending = this.#pending.get(snapshot.id);
    if (pending) {
      pending.snapshot = snapshot;
      return;
    }

    const committed = this.#entities.get(snapshot.id) || (snapshot.slotKey === "main" ? this.#main : null);
    const delay = this.perceptionDelayFor(entity);
    if (committed && now - committed.seenAt < delay * 0.82) {
      return;
    }

    this.#pending.set(snapshot.id, {
      snapshot,
      readyAt: now + delay,
    });
  }

  flushPendingSightings() {
    const now = this.obs.time;
    for (const [id, pending] of this.#pending) {
      if (pending.readyAt > now) {
        continue;
      }
      const snapshot = pending.snapshot;
      this.#store(snapshot, true);
      this.#pending.delete(id);
    }
  }

  snapshotEnemyContact(entity, source = "visible") {
    const zone = this.zoneForPoint(entity.x, entity.y);
    return freezePlainData(copyPlainData({
      id: entity.id,
      kind: entity.kind || "ship",
      key: entity.key || entity.slotKey || null,
      slotKey: entity.slotKey || entity.key || null,
      characterId: entity.characterId || null,
      x: entity.x,
      y: entity.y,
      angle: Number.isFinite(entity.angle) ? entity.angle : 0,
      speed: Number.isFinite(entity.speed) ? entity.speed : 0,
      hp: Number.isFinite(entity.hp) ? entity.hp : null,
      maxHp: Number.isFinite(entity.maxHp) ? entity.maxHp : null,
      radius: Number.isFinite(entity.radius) ? entity.radius : null,
      combatCapable: Boolean(entity.combatCapable),
      seenAt: this.obs.time,
      zoneId: zone.id,
      source,
      ...(entity.tactics || {
        bladeQueenRemaining: 0, catPawRemaining: 0, koizumiOrbRemaining: 0,
        haruhiImpactReady: false, haruhiSupportCount: 0, haruhiBoostActive: false,
        future1096Form: null, koizumiBarrierActive: false, koizumiBarrierRadius: 0,
        koizumiBarrierDisabledRemaining: 0,
      }),
    }));
  }

  ingestRadarContacts() {
    const radar = this.obs.self.radar;
    if (!radar) {
      return;
    }

    const now = this.obs.time;
    for (const radarContact of radar.contacts) {
      const targetId = Number(radarContact?.targetId ?? radarContact?.id);
      const detectedAt = Number(radarContact?.detectedAt);
      const expiresAt = Number(radarContact?.expiresAt);
      if (
        !Number.isFinite(targetId)
        || !Number.isFinite(detectedAt)
        || !Number.isFinite(radarContact?.x)
        || !Number.isFinite(radarContact?.y)
        || (Number.isFinite(expiresAt) && expiresAt <= now)
        || this.obs.enemy.visible.some((entity) => entity.id === targetId)
      ) {
        continue;
      }

      // 雷达本身已经带有位置误差；AI只读取同一份误差接触，不回查舰船真实坐标。
      // 难度仍影响其理解扫描结果的速度，避免简单难度瞬间响应。
      const clarity = clamp(Number(radarContact.clarity) || 0.12, 0.08, 0.92);
      const reactionDelay = clamp(
        (0.07 + (1 - clarity) * 0.1) * (this.reactionMult || 1),
        0.04,
        1.2,
      );
      if (now - detectedAt + 1e-9 < reactionDelay) {
        continue;
      }

      const existing = this.#entities.get(targetId)
        || (this.#main?.id === targetId ? this.#main : null);
      if (existing && existing.seenAt >= detectedAt) {
        continue;
      }

      const identifiedCharacterId = radarContact.characterId && CHARACTER_DEFS[radarContact.characterId]
        ? radarContact.characterId
        : null;
      const zone = this.zoneForPoint(radarContact.x, radarContact.y);
      const snapshot = {
        id: targetId,
        kind: "ship",
        // 远距离波动本身不能区分旗舰/副舰；角色可辨识后也只记录角色，不借实体 ID
        // 反查隐藏席位，保证 AI 与玩家拿到的信息等价。
        key: null,
        slotKey: null,
        // 仅在雷达进入可辨识范围后使用角色信息，远距离扫描不会偷看真实阵容身份。
        characterId: identifiedCharacterId,
        x: radarContact.x,
        y: radarContact.y,
        angle: Number.isFinite(radarContact.angle) ? radarContact.angle : 0,
        speed: CHARACTER_DEFS[identifiedCharacterId]?.stats?.speed || 31,
        hp: null,
        maxHp: null,
        radius: null,
        seenAt: detectedAt,
        zoneId: zone.id,
        source: "radar",
        confidence: clamp(0.2 + clarity * 0.74, 0.24, 0.88),
        uncertainty: clamp(Number(radarContact.uncertainty) || 90, 8, 260),
        radarExpiresAt: Number.isFinite(expiresAt) ? expiresAt : detectedAt + 3,
      };
      this.#store(snapshot);
    }
  }

  ingestShamisenHuntTarget() {
    const hunt = this.obs.self.hunt;
    if (!hunt || hunt.visible) {
      return;
    }
    const target = { id: hunt.targetId, x: hunt.x, y: hunt.y };
    const zone = this.zoneForPoint(target.x, target.y);
    // AI读取的内容与玩家看到的迷雾标记相同：精确位置会更新，但不偷看角色、席位、
    // 血量、朝向或舰体半径；source=hunt 也不会被当作真实视野。
    const snapshot = {
      id: target.id,
      kind: "ship",
      key: null,
      slotKey: null,
      characterId: null,
      x: target.x,
      y: target.y,
      angle: 0,
      speed: 0,
      hp: null,
      maxHp: null,
      radius: null,
      seenAt: this.obs.time,
      zoneId: zone.id,
      source: "hunt",
      confidence: 1,
      uncertainty: 0,
      visible: false,
    };
    this.#store(snapshot);
  }

  predictEnemyVector(contact) {
    if (!contact) {
      return {
        x: 0,
        y: 0,
        angle: 0,
        speed: 0,
      };
    }
    const baseSpeed = Number.isFinite(contact.speed) && contact.speed > 0 ? contact.speed : contact.kind === "ship" ? 31 : 72;
    let vx = Math.cos(contact.angle || 0) * baseSpeed;
    let vy = Math.sin(contact.angle || 0) * baseSpeed;

    const pressureTarget = this.obs.self.ships.main;
    const pullX = pressureTarget.x - contact.x;
    const pullY = pressureTarget.y - contact.y;
    const pullLen = Math.max(1, Math.hypot(pullX, pullY));
    const sourcePull = contact.source === "spawn" ? 0.56 : contact.source === "memory" ? 0.34 : 0.14;
    vx += (pullX / pullLen) * baseSpeed * sourcePull;
    vy += (pullY / pullLen) * baseSpeed * sourcePull;

    const len = Math.max(1, Math.hypot(vx, vy));
    return {
      x: vx,
      y: vy,
      angle: Math.atan2(vy, vx),
      speed: len,
    };
  }

  projectContact(contact, maxLead = 2.4) {
    if (!contact || !Object.isFrozen(contact)) return this.#projectContact(contact, maxLead);
    const observation = this.obs;
    const parameters = this.params;
    // 只复用同一不可变观测、参数与接触下的纯计算；动作失效会立即更换观测。
    if (observation !== this.#projectionObservation || parameters !== this.#projectionParams) {
      this.#projectionObservation = observation;
      this.#projectionParams = parameters;
      this.#projections = new WeakMap();
    }
    let leads = this.#projections.get(contact);
    if (!leads) { leads = new Map(); this.#projections.set(contact, leads); }
    if (!leads.has(maxLead)) leads.set(maxLead, freezePlainData(this.#projectContact(contact, maxLead)));
    return leads.get(maxLead);
  }

  #projectContact(contact, maxLead) {
    const I = this.params.intel.projection;
    if (!contact) {
      return null;
    }
    const age = Math.max(0, this.obs.time - contact.seenAt);
    const lead = contact.source === "spawn" ? 0 : Math.min(age * this.profile.memoryLeadMultiplier, Math.max(maxLead, 0)) * I.leadFactor;
    const padding = this.safeRoutePadding();
    const worldSize = this.obs.world.size;
    const travel = this.predictEnemyVector(contact);
    let x = clamp(contact.x + travel.x * lead, padding, worldSize - padding);
    let y = clamp(contact.y + travel.y * lead, padding, worldSize - padding);

    let source = contact.source;
    let confidence = 1;
    let radarDerived = false;
    if (source === "radar") {
      radarDerived = true;
      const freshDuration = Math.max(I.radarFreshMin, (contact.radarExpiresAt || contact.seenAt + I.radarDefaultLife) - contact.seenAt);
      source = age <= freshDuration ? "radar" : "memory";
      confidence = clamp((contact.confidence ?? I.radarDefaultConfidence) - age * I.radarConfidenceDecay, I.radarConfidenceMin, I.radarConfidenceMax);
    } else if (source === "spawn") {
      confidence = clamp(I.spawnConfidence - age * I.spawnConfidenceDecay, I.spawnConfidenceMin, I.spawnConfidence);
    } else if (age > TICK_DT * 1.5) {
      source = "memory";
      confidence = clamp(I.memoryConfidence - age * I.memoryConfidenceDecay, I.memoryConfidenceMin, I.memoryConfidence);
    }

    let uncertainty = 0;
    if (radarDerived) {
      uncertainty = clamp((contact.uncertainty || I.radarDefaultUncertainty) + age * I.radarUncertaintyGrowth, I.radarUncertaintyMin, I.radarUncertaintyMax);
    } else if (source === "spawn") {
      uncertainty = clamp(I.spawnUncertainty + age * I.spawnUncertaintyGrowth, I.spawnUncertainty, I.spawnUncertaintyMax);
    } else if (source === "memory") {
      uncertainty = clamp(I.memoryUncertainty + age * I.memoryUncertaintyGrowth + (1 - confidence) * I.memoryUncertaintyConfidence, I.memoryUncertainty, I.memoryUncertaintyMax);
    }

    if (uncertainty > 0 && !radarDerived) {
      const seed = contact.id * 97 + Math.round(contact.seenAt * 10);
      const sideAngle = travel.angle + Math.PI * 0.5;
      const forwardDrift = uncertainty * (I.forwardDriftBase + this.stableNoise(seed, 11) * I.forwardDriftNoise);
      const lateralDrift = uncertainty * (this.stableNoise(seed, 7) - 0.5) * I.lateralDrift;
      x = clamp(x + Math.cos(travel.angle) * forwardDrift + Math.cos(sideAngle) * lateralDrift, padding, worldSize - padding);
      y = clamp(y + Math.sin(travel.angle) * forwardDrift + Math.sin(sideAngle) * lateralDrift, padding, worldSize - padding);
    }

    const projectedZone = this.zoneForPoint(x, y);

    return {
      ...contact,
      x,
      y,
      zoneId: projectedZone.id,
      age,
      source,
      confidence,
      uncertainty,
      radarDerived,
      visible: source === "visible",
    };
  }

  rememberContact(entity, source = "visible") {
    const snapshot = this.snapshotEnemyContact(entity, source);
    this.#store(snapshot, true);
    return this.projectContact(snapshot, 0);
  }

  refreshIntel() {
    this.ingestRadarContacts();
    this.ingestShamisenHuntTarget();
    for (const entity of this.obs.enemy.visible) {
      this.queueSighting(entity);
    }
    this.flushPendingSightings();

    const staleCutoff = this.obs.time - 18;
    for (const [id, contact] of this.#entities) {
      if (contact.seenAt < staleCutoff) {
        this.#entities.delete(id);
      }
    }
  }

  visibleMainContact() {
    if (!this.#main || this.#main.source !== "visible") {
      return null;
    }
    const age = this.obs.time - this.#main.seenAt;
    if (age > 0.7) {
      return null;
    }
    return this.projectContact(this.#main, 0.3);
  }

  contactPriority(contact) {
    if (contact.slotKey === "main") {
      return 4;
    }
    if (contact.kind === "ship") {
      return 3;
    }
    if (contact.kind === "wingman") {
      return 2;
    }
    if (contact.kind === "scout" && contact.combatCapable) {
      return 2;
    }
    return 1;
  }

  freshestKnownContact({ requireShip = false, maxAge = 12 } = {}) {
    let best = null;
    for (const contact of this.#entities.values()) {
      if (requireShip && contact.kind !== "ship") {
        continue;
      }
      const age = this.obs.time - contact.seenAt;
      if (age > maxAge) {
        continue;
      }
      if (
        !best
        || contact.seenAt > best.seenAt
        || (contact.seenAt === best.seenAt && this.contactPriority(contact) > this.contactPriority(best))
      ) {
        best = contact;
      }
    }
    return best ? this.projectContact(best, 1.8) : null;
  }

  primaryEnemyEstimate() {
    const visibleMain = this.visibleMainContact();
    if (visibleMain) {
      return visibleMain;
    }

    // 雷达无法判断旗舰席位，但最新扫描到的任意舰船都比陈旧出生点更适合作为搜索焦点。
    let freshestRadar = null;
    for (const stored of this.#entities.values()) {
      if (stored.source !== "radar") continue;
      const projected = this.projectContact(stored, 1.8);
      if (
        projected.age <= 8
        && (!freshestRadar || stored.seenAt > freshestRadar.seenAt)
      ) {
        freshestRadar = { ...projected, seenAt: stored.seenAt };
      }
    }
    if (freshestRadar) {
      return freshestRadar;
    }

    const mainIntel = this.projectContact(this.#main, this.#main?.source === "spawn" ? 0 : 2.6);
    if (mainIntel && (mainIntel.age <= 16 || mainIntel.source === "spawn")) {
      return mainIntel;
    }

    const recentShip = this.freshestKnownContact({ requireShip: true, maxAge: 10 });
    if (recentShip) {
      return recentShip;
    }

    return this.freshestKnownContact({ requireShip: false, maxAge: 6 }) || mainIntel;
  }

  knownEnemyContacts({ maxAge = 10, includeScouts = false } = {}) {
    const contacts = [];
    for (const stored of this.#entities.values()) {
      const projected = this.projectContact(stored, 1.8);
      if (!projected || projected.age > maxAge) {
        continue;
      }
      if (!includeScouts && projected.kind === "scout" && !projected.combatCapable) {
        continue;
      }
      contacts.push(projected);
    }

    const mainEstimate = this.projectContact(this.#main, this.#main?.source === "spawn" ? 0 : 1.8);
    if (mainEstimate && mainEstimate.age <= maxAge && !contacts.some((item) => item.id === mainEstimate.id)) {
      if (includeScouts || mainEstimate.kind !== "scout" || mainEstimate.combatCapable) {
        contacts.unshift(mainEstimate);
      }
    }
    return contacts;
  }
}
