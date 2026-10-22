import { sampleAttributeFacts, sampleControlFacts, sampleImmunityFacts, sampleDamageFacts } from "./attribute-facts.js";
import { evaluateAttribute, evaluateControl, evaluateDamageImmunity, evaluateDamageTaken, evaluateFlightSpeed, evaluateMinimumSpeed } from "./attribute-evaluation.js";
import { CHARACTER_EXTENSIONS } from "../assembly/registry.js";
import { composeCapabilities, compileHooks, compileTimedAttributes } from "../assembly/extension-contract.js";

const timedAttributes = compileTimedAttributes(CHARACTER_EXTENSIONS);

const queries = compileHooks(CHARACTER_EXTENSIONS.map((extension) => ({ hooks: extension.queries })), ["barrierRamProfile", "fireRate", "hullCollision", "broadcast"]);

const sharedRules = Object.freeze({
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
    return evaluateAttribute(sampleAttributeFacts(ship), statKey, baseValue, timedAttributes);
  },
  effectiveSpeed(ship) {
    const speeds = ship.team.fleetMembersForShip(ship).map((member) =>
      evaluateAttribute(sampleAttributeFacts(member), "speed", member.base.speed, timedAttributes));
    return evaluateFlightSpeed(sampleControlFacts(ship), speeds, ship.isControlImmune());
  },
  minimumFlightSpeed(ship) {
    return evaluateMinimumSpeed(sampleAttributeFacts(ship), timedAttributes);
  },
  damageTakenMultiplier(ship) {
    return evaluateDamageTaken(sampleDamageFacts(ship));
  },
});

export const CHARACTER_RULES = Object.freeze({ ...composeCapabilities([{ capabilities: sharedRules }, ...CHARACTER_EXTENSIONS.map((extension) => ({ capabilities: extension.rules }))]) });
