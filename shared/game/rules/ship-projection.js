// 权威舰船的只读投影；协议字段允许描述具体角色，实体推进不依赖这些字段。
import { serializeShipStatusEffects, statusEffectNames } from "../status-effects.js";
import { serializeKoizumiOrb } from "../koizumi-orb.js";
import { haruhiOtherworlderReady } from "../haruhi-flagship.js";
import { serializeHaruhiHeroPowerShock } from "../haruhi-hero-power.js";
import { serializeBunnyCompanion } from "../bunny-companion-runtime.js";
import { serializeBunnyShip } from "../rules/bunny-projection.js";

export function projectShip(ship) {
  const fleetEnergy = ship.team.fleetEnergyForShip(ship);
  const statusEffects = serializeShipStatusEffects(ship);
  return {
    id: ship.id,
    key: ship.key,
    slotKey: ship.slotKey,
    characterId: ship.characterId,
    characterName: ship.character.name,
    name: ship.name,
    x: ship.x,
    y: ship.y,
    angle: ship.angle,
    speed: ship.speed,
    cooldown: ship.cooldown,
    hp: ship.hp,
    maxHp: ship.maxHp,
    energy: ship.energy,
    maxEnergy: ship.maxEnergy,
    fleetEnergy: fleetEnergy.current,
    fleetMaxEnergy: fleetEnergy.max,
    alive: ship.alive,
    radius: ship.radius,
    throttle: ship.throttle,
    vision: ship.effectiveVision(),
    range: ship.effectiveRange(),
    attached: ship.isAttached(),
    canControl: ship.canControl(),
    bladeQueen: ship.hasEffect("bladeQueenUntil"), // 刀锋女王激活中:两端渲染层据此画猩红刀锋光环
    catPawVolley: ship.hasEffect("catPawUntil"),
    silenced: ship.isSilenced(),
    stunRemaining: Math.max(0, (ship.effects.stunnedUntil || 0) - ship.team.match.elapsed),
    silenceRemaining: Math.max(0, (ship.effects.silencedUntil || 0) - ship.team.match.elapsed),
    heroPowerShock: serializeHaruhiHeroPowerShock(ship),
    koizumiOrb: serializeKoizumiOrb(ship),
    knockedBack: Boolean(ship.forcedKnockback),
    haruhiImpactReady: ship.key === "main" && haruhiOtherworlderReady(ship.team),
    clawMarks: (() => {
      const marks = ship.activeClawMarks();
      return {
        sourceSeat: marks.sourceSeat,
        stacks: marks.stacks,
        required: marks.required,
        expiresIn: Math.max(0, marks.expiresAt - ship.team.match.elapsed),
        color: marks.color,
      };
    })(),
    nameRevealed: ship.nameRevealed, // 角色名是否已被敌方永久确认
    buffs: statusEffectNames(statusEffects),
    statusEffects,
    ...(ship.bunnyHaruhi || ship.bunnyStageExposure ? serializeBunnyShip(ship) : {}),
    ...(ship.bunnyCompanion ? serializeBunnyCompanion(ship) : {}),
    ...(ship.bunnyReliable ? { bunnyReliable: {
      sourceCompanionId: ship.bunnyReliable.sourceCompanionId,
      remaining: Math.max(0, ship.bunnyReliable.until - ship.team.match.elapsed),
      suppressed: ship.bunnyReliable.suppressed,
    } } : {}),
    route: ship.route
      ? {
          anchorToMain: ship.route.anchorToMain,
          p0: { ...ship.route.p0 },
          p1: { ...ship.route.p1 },
          p2: { ...ship.route.p2 },
          t: ship.route.t,
        }
      : null,
  };
}
