import { BUNNY_HARUHI_CONFIG as C } from "./config.js";
import { nextBunnyForm, isBunnyEncoreLocked, isBunnyBroadcasting, isBunnyControlLocked } from "./rules.js";
import { bunnyHaruhiSupportSource } from "./support.js";
import { supportOrbGeometry, supportOtherworlderReady } from "../haruhi/support.js";
import { bunnyCompanions } from "./companion-runtime.js";
import { bunnyTransformBlockReason } from "./form-port.js";
import { bunnyStageEnabled } from "./stage-port.js";

/** 只输出白名单摘要，不暴露Set、首次领取历史、支援队列或可写实体引用。 */
export function serializeBunnyShip(ship) {
  const now = ship.team.match.elapsed;
  const fields = {};
  if (ship.bunnyHaruhi) {
    const state = ship.bunnyHaruhi;
    const enabled = !ship.team.areSkillsDisabled() && ship.alive;
    const source = bunnyHaruhiSupportSource(ship, enabled);
    const companion = bunnyCompanions(ship.team.match).find((candidate) => candidate.id === state.companionId);
    const blockReason = bunnyTransformBlockReason(ship);
    fields.bunnyHaruhi = {
      form: state.form, nextForm: nextBunnyForm(state), successfulCasts: state.successfulCasts,
      scoutsDisabled: state.scoutsDisabled, positiveSuppressed: state.positiveSuppressed,
      immunityRemaining: Math.max(0, state.immunityUntil - now),
      drainRemaining: Math.max(0, state.drainUntil - now),
      broadcastRemaining: Math.max(0, state.broadcastUntil - now),
      supporters: C.supportIds.filter((id) => state.support.supporters.has(id)),
      blockReason, canTransform: blockReason === null, enabled,
      lockedGear: isBunnyEncoreLocked(state, now, enabled) ? C.encore.lockedGear : null,
      broadcasting: enabled && isBunnyBroadcasting(state, now),
      esperOrb: supportOrbGeometry(source), otherworlderReady: supportOtherworlderReady(source, now),
      companionId: state.companionId, companionSpawned: state.companionSpawned,
      companion: companion ? { alive: companion.alive, teamSeat: companion.team.seat,
        convertedRemaining: Math.max(0, companion.bunnyCompanion.convertedUntil - now) } : null,
    };
  }
  if (ship.bunnyStageExposure) {
    const state = ship.bunnyStageExposure;
    fields.bunnyStageExposure = {
      sourceShipId: state.sourceShipId, phase: state.phase, inside: state.inside,
      controlLocked: !ship.isControlImmune() && isBunnyControlLocked(state, now, bunnyStageEnabled(ship)),
      lockRemaining: Math.max(0, state.lockUntil - now), recoveryRemaining: Math.max(0, state.recoveryUntil - now),
      entranceRemaining: state.inside ? Math.max(0, state.enteredAt + C.stage.entranceSeconds - now) : 0,
    };
  }
  return fields;
}
