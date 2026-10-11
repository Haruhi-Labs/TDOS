import { sampleAttributeFacts, sampleControlFacts, sampleImmunityFacts, sampleDamageFacts } from "./attribute-facts.js";
import { evaluateAttribute, evaluateControl, evaluateDamageImmunity, evaluateDamageTaken, evaluateFlightSpeed, evaluateMinimumSpeed } from "./attribute-evaluation.js";
import { CHARACTER_EXTENSIONS } from "./extensions/index.js";
import { composeCapabilities, compileHooks } from "./extension-contract.js";

const capabilities = composeCapabilities(CHARACTER_EXTENSIONS.map((extension) => ({ capabilities: extension.rules })));
const queries = compileHooks(CHARACTER_EXTENSIONS.map((extension) => ({ hooks: extension.queries })), ["barrierRamProfile", "fireRate", "hullCollision", "broadcast"]);

export const CHARACTER_RULES = Object.freeze({
  ...capabilities,
  barrierRamProfile: (...args) => queries.first("barrierRamProfile", null, ...args),
  effectiveFireRate: (ship) => queries.reduce("fireRate", ship.statWithBuffs("fireRate", ship.base.fireRate), ship),
  participatesInHullCollision: (ship) => !ship.forcedKnockback && queries.all("hullCollision", ship).every(Boolean),
  broadcastShips: (team) => queries.all("broadcast", team).flat(),
  controlStopsFlight(ship) {
    return evaluateControl(sampleControlFacts(ship), ship.isControlImmune()).stopsFlight;
  },
  controlLocked(ship) {
    return evaluateControl(sampleControlFacts(ship), ship.isControlImmune()).locked;
  },
  silenced(ship) {
    return evaluateControl(sampleControlFacts(ship), ship.isControlImmune()).silenced;
  },
  controlImmune(ship) {
    return ship.isKoizumiOrbActive();
  },
  damageImmune(ship) {
    return evaluateDamageImmunity(sampleImmunityFacts(ship), ship.isKoizumiOrbActive());
  },
  statWithBuffs(ship, statKey, baseValue) {
    return evaluateAttribute(sampleAttributeFacts(ship), statKey, baseValue);
  },
  effectiveSpeed(ship) {
    const speeds = ship.team.fleetMembersForShip(ship).map((member) =>
      evaluateAttribute(sampleAttributeFacts(member), "speed", member.base.speed));
    return evaluateFlightSpeed(sampleControlFacts(ship), speeds, ship.isControlImmune());
  },
  minimumFlightSpeed(ship) {
    return evaluateMinimumSpeed(sampleAttributeFacts(ship));
  },
  damageTakenMultiplier(ship) {
    return evaluateDamageTaken(sampleDamageFacts(ship));
  },
});
