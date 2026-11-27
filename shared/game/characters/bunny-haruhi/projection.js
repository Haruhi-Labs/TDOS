import { STATUS_EFFECT_DEFS } from "../../projection/status-effect-definitions.js";
import { BUNNY_VIEW_PARAMS } from "./view-params.js";
import { bunnyBroadcastsShip } from "./form-port.js";
import { bunnyCompanionForm, bunnyCompanionOwner, bunnyReliableState } from "./companion-runtime.js";
import { BUNNY_HARUHI_CONFIG as C } from "./config.js";
import { nextBunnyForm, isBunnyEncoreLocked, isBunnyBroadcasting, isBunnyControlLocked } from "./rules.js";
import { bunnyHaruhiSupportSource } from "./support.js";
import { supportOrbGeometry, supportOtherworlderReady } from "../haruhi/support.js";
import { bunnyCompanions } from "./companion-runtime.js";
import { bunnyTransformBlockReason } from "./form-port.js";
import { bunnyStageEnabled, bunnyStageSourceInfo } from "./stage-port.js";

/** 只读发布当前舞台曝光的来源读模型，供多舰队观测与新快照消费；不推进治疗、禁控或来源清理。 */
export function projectBunnyStageExposureSource(ship) {
  const state = ship?.bunnyStageExposure;
  if (!state) return null;
  const now = ship.team.match.elapsed;
  const enabled = bunnyStageEnabled(ship);
  const source = bunnyStageSourceInfo(ship);
  return Object.freeze({
    sourceShipId: state.sourceShipId,
    sourceSeat: source?.seat ?? null,
    sourceSideId: source?.sideId ?? null,
    inside: state.inside,
    enabled,
    phase: state.phase,
    controlLocked: !ship.isControlImmune() && isBunnyControlLocked(state, now, enabled),
    lockRemaining: Math.max(0, state.lockUntil - now),
    recoveryRemaining: Math.max(0, state.recoveryUntil - now),
    entranceRemaining: state.inside ? Math.max(0, state.enteredAt + C.stage.entranceSeconds - now) : 0,
  });
}

/** 只读发布伴随舰的永久母舰与当前归属事实，供多舰队观测与终局事实层消费；不暴露可写集合或实体引用。 */
export function projectBunnyCompanionOwnership(ship) {
  const state = ship?.bunnyCompanion;
  if (!state) return null;
  const now = ship.team.match.elapsed;
  const owner = bunnyCompanionOwner(ship);
  const ownerTeam = owner?.team || ship.team.match.teamBySeat(state.ownerSeat);
  const convertedRemaining = Math.max(0, state.convertedUntil - now);
  return Object.freeze({
    entityId: ship.id,
    key: ship.key,
    entityRole: C.companionRole,
    alive: Boolean(ship.alive),
    ownerShipId: state.ownerShipId,
    ownerSeat: state.ownerSeat,
    ownerSideId: ownerTeam?.sideId ?? null,
    currentSeat: ship.team.seat,
    currentSideId: ship.team.sideId ?? null,
    converted: state.convertedUntil > 0 && convertedRemaining > 0,
    convertedRemaining,
    reliableRemaining: Math.max(0, state.reliableUntil - now),
    nextReliableRemaining: state.nextReliableAt === null ? null : Math.max(0, state.nextReliableAt - now),
    sameOwnerTeam: Boolean(owner && ship.team === owner.team),
  });
}

/** 只输出白名单摘要，不暴露Set、首次领取历史、支援队列或可写实体引用；默认保持旧快照结构不变。 */
export function serializeBunnyShip(ship, { includeSourceDetails = false } = {}) {
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
      companion: companion ? {
        alive: companion.alive, teamSeat: companion.team.seat,
        convertedRemaining: Math.max(0, companion.bunnyCompanion.convertedUntil - now),
        ...(includeSourceDetails ? {
          ownerSeat: companion.bunnyCompanion.ownerSeat,
          teamSideId: companion.team.sideId ?? null,
        } : {}),
      } : null,
    };
  }
  if (ship.bunnyStageExposure) {
    const state = ship.bunnyStageExposure;
    const source = includeSourceDetails ? bunnyStageSourceInfo(ship) : null;
    fields.bunnyStageExposure = {
      sourceShipId: state.sourceShipId, phase: state.phase, inside: state.inside,
      controlLocked: !ship.isControlImmune() && isBunnyControlLocked(state, now, bunnyStageEnabled(ship)),
      lockRemaining: Math.max(0, state.lockUntil - now), recoveryRemaining: Math.max(0, state.recoveryUntil - now),
      entranceRemaining: state.inside ? Math.max(0, state.enteredAt + C.stage.entranceSeconds - now) : 0,
      ...(includeSourceDetails ? {
        sourceSeat: source?.seat ?? null,
        sourceSideId: source?.sideId ?? null,
      } : {}),
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
