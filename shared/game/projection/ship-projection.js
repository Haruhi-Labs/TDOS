// 权威舰船的只读投影；协议字段允许描述具体角色，实体推进不依赖这些字段。
import { serializeShipStatusEffects, statusEffectNames } from "./status-effects.js";
import { CHARACTER_EXTENSIONS } from "../characters/assembly/registry.js";
import { projectExtensions } from "../characters/assembly/extension-contract.js";
import { orderedProjection, SHIP_WIRE_FIELDS } from "./projection-order.js";

export function projectShip(ship) {
  const fleetEnergy = ship.team.fleetEnergyForShip(ship);
  const statusEffects = serializeShipStatusEffects(ship);
  return orderedProjection({
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
    silenced: ship.isSilenced(),
    stunRemaining: Math.max(0, (ship.effects.stunnedUntil || 0) - ship.team.match.elapsed),
    silenceRemaining: Math.max(0, (ship.effects.silencedUntil || 0) - ship.team.match.elapsed),
    knockedBack: Boolean(ship.forcedKnockback),
    nameRevealed: ship.nameRevealed, // 角色名是否已被敌方永久确认
    buffs: statusEffectNames(statusEffects),
    statusEffects,
    route: ship.route
      ? {
          anchorToMain: ship.route.anchorToMain,
          p0: { ...ship.route.p0 },
          p1: { ...ship.route.p1 },
          p2: { ...ship.route.p2 },
          t: ship.route.t,
        }
      : null,
  }, projectExtensions(CHARACTER_EXTENSIONS, "projectShip", ship), SHIP_WIRE_FIELDS);
}
