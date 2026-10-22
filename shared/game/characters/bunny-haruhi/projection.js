import { STATUS_EFFECT_DEFS } from "../../projection/status-effect-definitions.js";
import { BUNNY_VIEW_PARAMS } from "./view-params.js";
import { bunnyBroadcastsShip } from "./form-port.js";
import { bunnyCompanionForm, bunnyReliableState } from "./companion-runtime.js";
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

// 只发送该图标需要的文案参数，避免覆盖 duration 等状态寿命字段。
const BUNNY_STATUS_PARAMS = Object.fromEntries(Object.entries(STATUS_EFFECT_DEFS)
  .filter(([id]) => id.startsWith("bunny_"))
  .map(([id, definition]) => [id, Object.fromEntries([...definition.description.matchAll(/\{(\w+)\}/g)]
    .map(([, key]) => [key, BUNNY_VIEW_PARAMS[key]]))]));

// 状态栏投影只读取角色状态，生命周期仍由对应运行时消费。
export function projectBunnyStatuses(ship, { add }) {
  const team = ship.team;
  const now = team.match.elapsed;
  const form = ship.bunnyHaruhi || (ship.bunnyCompanion ? bunnyCompanionForm(ship) : null);
  const enabled = !team.areSkillsDisabled();
  const bunny = (id, end = null, duration = null) => add(id, end, duration, BUNNY_STATUS_PARAMS[id]);
  if (form) {
    if (form.form === "bless") {
      if (enabled && !form.positiveSuppressed) bunny("bunny_bless");
      bunny("bunny_vulnerable");
    }
    if (form.form === "knows") {
      bunny("bunny_knows");
      if (enabled) {
        bunny("bunny_immunity", form.immunityUntil, C.knows.immunitySeconds);
        if (ship.bunnyHaruhi) bunny("bunny_drain", form.drainUntil, C.knows.selfDrainSeconds);
      }
    }
    if (ship.bunnyHaruhi && enabled && form.form === "encore") {
      bunny("bunny_encore", form.formStartedAt + C.encore.lockSeconds, C.encore.lockSeconds);
    }
    if (ship.bunnyHaruhi && ship.key !== "main" && enabled) {
      for (const id of C.supportIds) if (form.support.supporters.has(id)) bunny(`bunny_${id}`);
    }
  }
  const stage = ship.bunnyStageExposure;
  if (stage && bunnyStageEnabled(ship)) {
    if (stage.phase === "speechless") bunny("bunny_speechless", stage.enteredAt + C.stage.entranceSeconds, C.stage.entranceSeconds);
    if (stage.phase === "entranced") bunny("bunny_entranced");
    if (!ship.isControlImmune()) {
      bunny("bunny_lock", stage.lockUntil, C.stage.lockSeconds);
      if (now >= stage.lockUntil) bunny("bunny_recovery", stage.recoveryUntil, C.stage.recoverySeconds);
    }
  }
  const reliable = ship.bunnyReliable && bunnyReliableState(ship);
  if (enabled && reliable && !reliable.suppressed) bunny("bunny_reliable", reliable.until, C.companion.durationSeconds);
  if (ship.bunnyCompanion?.convertedUntil > now) bunny("bunny_converted", ship.bunnyCompanion.convertedUntil, C.companion.bribeSeconds);
  if (team.match.bunnyHaruhiActive && bunnyBroadcastsShip(team, ship)) bunny("bunny_broadcast");
}
