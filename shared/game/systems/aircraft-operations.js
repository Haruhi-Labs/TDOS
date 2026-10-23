import { clamp } from "../foundation/math.js";

export class AircraftOperations {
  #scoutView;
  #wingmanView;
  #port;
  #config;
  #scouts = [];
  #wingmen = [];
  #autoScout = Object.freeze({ enabled: false, zoneId: 5 });
  constructor(port, config) { this.#port = port; this.#config = Object.freeze({ ...config }); }
  get scouts() { return this.#scoutView ??= Object.freeze([...this.#scouts]); }
  get wingmen() { return this.#wingmanView ??= Object.freeze([...this.#wingmen]); }
  get autoScout() { return this.#autoScout; }
  acceptsScout(scout) { return this.#accepts(scout, "scout", this.#scouts); }
  acceptsWingman(wingman) { return this.#accepts(wingman, "wingman", this.#wingmen); }
  #accepts(entity, kind, members) {
    return Boolean(entity && entity.kind === kind && this.#port.sameMatch(entity)
      && !members.some((member) => member === entity || member.id === entity.id));
  }
  addScout(scout) {
    if (!this.acceptsScout(scout) || !this.#port.owns(scout)) return false;
    this.#scoutView = undefined;
    this.#scouts.push(scout);
    return true;
  }
  removeScout(scout) {
    this.#scoutView = undefined;
    this.#scouts = this.#scouts.filter((item) => item !== scout);
  }
  addWingman(wingman) {
    if (!this.acceptsWingman(wingman) || !this.#port.owns(wingman)) return false;
    this.#wingmanView = undefined;
    this.#wingmen.push(wingman);
    return true;
  }
  removeWingman(wingman) {
    this.#wingmanView = undefined;
    this.#wingmen = this.#wingmen.filter((item) => item !== wingman);
  }
  configureAutoScout(enabled, zoneId) {
    this.#autoScout = Object.freeze({ enabled: Boolean(enabled), zoneId: Number.isFinite(Number(zoneId))
      ? clamp(Number(zoneId), 1, 9) : this.#autoScout.zoneId });
    return true;
  }
  advance(dt) {
    this.maybeAutoLaunchScout();
    for (const scout of this.#scouts) scout.update(dt);
    for (const wingman of this.#wingmen) wingman.update(dt);
  }
  collectRetired() {
    this.#wingmanView = undefined;
    this.#scoutView = undefined;
    this.#scouts = this.#scouts.filter((item) => item.alive);
    this.#wingmen = this.#wingmen.filter((item) => item.alive);
  }
  maybeAutoLaunchScout() {
    if (!this.#autoScout.enabled) {
      return false;
    }
    return this.launchScout(this.#autoScout.zoneId, {
      cooldownMultiplier: this.#config.autoCooldownMultiplier,
    });
  }

  assignScoutMission(scout, options = {}) {
    if (!scout?.alive || !this.#scouts.includes(scout)) {
      return false;
    }
    const zone = this.#port.world.zoneById(options.zoneId || scout.zone?.id || 5);
    scout.assignMission(zone, options);
    return true;
  }

  launchScout(zoneId, options = {}) {
    this.#scoutView = undefined;
    if (!this.#port.orderAvailable(options.fromShipKey)) return false;
    const cost = this.#config.scoutCost;
    const cooldownMultiplier = Number.isFinite(options.cooldownMultiplier) ? Math.max(1, options.cooldownMultiplier) : 1;
    if (this.#port.disabled()) {
      return false;
    }
    if (this.#port.cooldowns.scout > 0) {
      return false;
    }
    // 侦察机从「指定舰船」处发出(默认主舰)——前出的分离舰可更快把侦察部署到位。
    // 能量从该舰所属能量池扣除(分离后副舰用自己的池)。
    const requested = options.fromShipKey ? this.#port.source(options.fromShipKey) : null;
    if (requested && requested.controlLocked) {
      return false;
    }
    const source = (requested && requested.alive ? requested : null)
      || (this.#port.source("main").alive ? this.#port.source("main") : this.#port.sources().find((ship) => ship.alive));
    if (!source || source.controlLocked || !source.launchAvailable) {
      return false;
    }
    if (!this.#port.spendEnergy(source.key || "main", cost)) {
      return false;
    }
    const zone = this.#port.world.zoneById(zoneId);
    const launchCount = this.#port.launchCount();
    const lateralAngle = source.angle + Math.PI * 0.5;
    const lateralDistance = source.radius + 6;
    for (let index = 0; index < launchCount; index += 1) {
      const side = launchCount === 1 ? 0 : index * 2 - 1;
      const x = this.#port.world.clampX(source.x + Math.cos(lateralAngle) * lateralDistance * side, 8);
      const y = this.#port.world.clampY(source.y + Math.sin(lateralAngle) * lateralDistance * side, 8);
      this.addScout(this.#port.createScout(x, y, {
        zone,
        seekPoint: options.seekPoint,
        mission: options.mission,
        patrolCenter: options.patrolCenter,
        patrolRadius: options.patrolRadius,
      }));
    }
    this.#port.startCooldown("scout", this.#config.scoutCooldown * cooldownMultiplier);
    this.#port.record(options.cooldownMultiplier ? "auto_scout" : "launch_scout");
    return true;
  }

  launchWingman(zoneId) {
    this.#wingmanView = undefined;
    const cost = 55;
    if (this.#port.cooldowns.flagship > 0) {
      return false;
    }
    if (!this.#port.spendEnergy("main", cost)) {
      return false;
    }
    const zone = this.#port.world.zoneById(zoneId);
    const main = this.#port.source("main");
    if (!main.alive) {
      return false;
    }
    this.addWingman(this.#port.createWingman(main.x, main.y, zone));
    return true;
  }

}
