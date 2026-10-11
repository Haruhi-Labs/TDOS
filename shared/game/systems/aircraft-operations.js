import { clamp } from "../math.js";
const TAU = Math.PI * 2;

export class AircraftOperations {
  #port;
  #config;
  #scouts = [];
  #wingmen = [];
  #autoScout = Object.freeze({ enabled: false, zoneId: 5 });
  constructor(port, config) { this.#port = port; this.#config = Object.freeze({ ...config }); }
  get scouts() { return Object.freeze([...this.#scouts]); }
  get wingmen() { return Object.freeze([...this.#wingmen]); }
  get autoScout() { return this.#autoScout; }
  addScout(scout) { this.#scouts.push(scout); }
  removeScout(scout) { this.#scouts = this.#scouts.filter((item) => item !== scout); }
  addWingman(wingman) { this.#wingmen.push(wingman); }
  removeWingman(wingman) { this.#wingmen = this.#wingmen.filter((item) => item !== wingman); }
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
      this.#scouts.push(this.#port.createScout(x, y, {
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
    this.#wingmen.push(this.#port.createWingman(main.x, main.y, zone));
    return true;
  }

  launchBurstScouts(ship) {
    const directions = 8;
    for (let i = 0; i < directions; i += 1) {
      const angle = (TAU / directions) * i;
      for (const offset of [-0.07, 0.07]) {
        const targetAngle = angle + offset;
        const anchor = {
          x: this.#port.world.clampX(ship.x + Math.cos(targetAngle) * 230, 22),
          y: this.#port.world.clampY(ship.y + Math.sin(targetAngle) * 230, 22),
        };
        this.#scouts.push(
          this.#port.createScout(ship.x, ship.y, {
            pattern: "burst",
            anchor,
            anchorRadius: 18,
            speed: 118,
            vision: 82,
            life: 10.5,
            radius: 3,
          }),
        );
      }
    }
  }

  launchHaruhiAlienWingmen(ship) {
    const zone = this.#port.zoneForPoint(ship.x, ship.y);
    const releaseAngle = this.#port.randomRange(0, TAU);
    const spawnRadius = ship.radius + 12;
    const x = this.#port.world.clampX(ship.x + Math.cos(releaseAngle) * spawnRadius, 8);
    const y = this.#port.world.clampY(ship.y + Math.sin(releaseAngle) * spawnRadius, 8);
    this.#scouts.push(this.#port.createScout(x, y, { zone, combatCapable: true }));
    this.#port.world.spawnBurst(x, y, "#8fe8ff", 5);
  }

}
