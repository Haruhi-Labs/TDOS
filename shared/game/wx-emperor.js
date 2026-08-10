export const WX_ANCHOR_COST = 20;
export const WX_ANCHOR_UPKEEP = 8;
export const WX_ANCHOR_SELF_DAMAGE_TAKEN = 0.769;
export const WX_ANCHOR_SELF_KNOCKBACK = 0.6325;
export const WX_ANCHOR_SELF_RANGE = 1.105;
export const WX_ANCHOR_SELF_FIRE_RATE = 1.063;
export const WX_ANCHOR_SELF_DAMAGE = 1.084;
export const WX_ANCHOR_FLEET_DAMAGE_TAKEN = 0.916;
export const WX_ANCHOR_FLEET_KNOCKBACK = 0.8425;
export const WX_DUEL_RADIUS = 160;
export const WX_DUEL_DAMAGE = 1.084;
export const WX_DUEL_FIRE_RATE = 1.084;
export const WX_CHALLENGE_DURATION = 3;
export const WX_OVERHEAT_DURATION = 4;

export const IMPERIAL_GUARD_DURATION = 6;
export const IMPERIAL_GUARD_DAMAGE_TAKEN = 0.79;
export const IMPERIAL_MIGHT_DURATION = 6;
export const IMPERIAL_MIGHT_DAMAGE = 1.2625;
export const IMPERIAL_CAMPAIGN_DAMAGE_RATIO = 0.189;
export const IMPERIAL_CAMPAIGN_BOLT_SPEED = 300;
export const IMPERIAL_CAMPAIGN_COLOR = "#ffd86e";
export const IMPERIAL_COMBO_FLASH_DURATION = 1.3;

export const WX_IMPERIAL_SKILLS = Object.freeze([
  Object.freeze({
    id: "imperial_guard",
    nameKey: "wx_skill_imperial_guard",
    descKey: "wx_skill_imperial_guard_desc",
    kind: "buff",
    color: "#d9f2ff",
  }),
  Object.freeze({
    id: "imperial_campaign",
    nameKey: "wx_skill_imperial_campaign",
    descKey: "wx_skill_imperial_campaign_desc",
    kind: "attack",
    color: IMPERIAL_CAMPAIGN_COLOR,
  }),
  Object.freeze({
    id: "imperial_might",
    nameKey: "wx_skill_imperial_might",
    descKey: "wx_skill_imperial_might_desc",
    kind: "buff",
    color: "#ffdf8e",
  }),
]);

export function createWxAnchorState() {
  return {
    active: false,
    scope: "self",
    shipKey: null,
    activatedAt: 0,
    remaining: 0,
    overheatRemaining: 0,
    challengePulse: null,
    duelZone: null,
  };
}

export function normalizeWxAnchorSnapshot(value) {
  const source = value && typeof value === "object" ? value : {};
  const normalizePoint = (point, includeRemaining = false) => {
    if (!point || !Number.isFinite(Number(point.x)) || !Number.isFinite(Number(point.y))) {
      return null;
    }
    const normalized = {
      x: Number(point.x),
      y: Number(point.y),
      radius: Math.max(1, Number(point.radius) || WX_DUEL_RADIUS),
    };
    if (includeRemaining) {
      normalized.remaining = Math.max(0, Number(point.remaining) || 0);
    }
    return normalized;
  };
  return {
    active: Boolean(source.active),
    scope: source.scope === "fleet" ? "fleet" : "self",
    remaining: Math.max(0, Number(source.remaining) || 0),
    overheatRemaining: Math.max(0, Number(source.overheatRemaining) || 0),
    challengePulse: normalizePoint(source.challengePulse, true),
    duelZone: normalizePoint(source.duelZone),
  };
}

export function wxAnchorStateForShip(team, ship) {
  const state = team?.wxAnchor;
  return state?.active && ship?.alive && state.shipKey === ship.key ? state : null;
}

export function wxAnchorAffectsFleet(team, ship) {
  return Boolean(
    team?.wxAnchor?.active
      && team.wxAnchor.scope === "fleet"
      && ship?.alive
      && team.getPlayerShips?.().includes(ship),
  );
}

export function wxAnchorLockForShip(team, ship) {
  return Boolean(wxAnchorStateForShip(team, ship));
}

export function wxAnchorDamageTakenMultiplier(team, ship) {
  if (wxAnchorStateForShip(team, ship)) return WX_ANCHOR_SELF_DAMAGE_TAKEN;
  if (wxAnchorAffectsFleet(team, ship)) return WX_ANCHOR_FLEET_DAMAGE_TAKEN;
  return 1;
}

export function wxAnchorKnockbackMultiplier(team, ship) {
  if (wxAnchorStateForShip(team, ship)) return WX_ANCHOR_SELF_KNOCKBACK;
  if (wxAnchorAffectsFleet(team, ship)) return WX_ANCHOR_FLEET_KNOCKBACK;
  return 1;
}

export function wxAnchorBoostsShip(team, ship, stat) {
  if (!wxAnchorStateForShip(team, ship)) return 1;
  if (stat === "range") return WX_ANCHOR_SELF_RANGE;
  if (stat === "fireRate") return WX_ANCHOR_SELF_FIRE_RATE;
  if (stat === "damage") return WX_ANCHOR_SELF_DAMAGE;
  return 1;
}

export function wxEntityInDuelZone(team, entity) {
  const zone = team?.wxAnchor?.duelZone;
  if (!zone || !entity?.alive) return false;
  const dx = Number(entity.x) - zone.x;
  const dy = Number(entity.y) - zone.y;
  return dx * dx + dy * dy <= zone.radius * zone.radius;
}

export function wxDuelBoostForTarget(team, source, target, stat) {
  const zoneTeams = [team, target?.team].filter(Boolean);
  const sharesZone = zoneTeams.some(
    (zoneTeam) => wxEntityInDuelZone(zoneTeam, source) && wxEntityInDuelZone(zoneTeam, target),
  );
  if (!sharesZone) return 1;
  return stat === "damage" ? WX_DUEL_DAMAGE : WX_DUEL_FIRE_RATE;
}

export function serializeWxAnchor(team, { publicOnly = false } = {}) {
  const state = team?.wxAnchor;
  if (!state) return null;
  const challengePulse = state.challengePulse?.remaining > 0 ? { ...state.challengePulse } : null;
  if (publicOnly) return challengePulse ? { challengePulse } : null;
  return {
    active: Boolean(state.active),
    scope: state.scope === "fleet" ? "fleet" : "self",
    remaining: Math.max(0, Number(state.remaining) || 0),
    overheatRemaining: Math.max(0, Number(state.overheatRemaining) || 0),
    challengePulse,
    duelZone: state.duelZone ? { ...state.duelZone } : null,
  };
}

export function wxComboFlashesForViewer(flashes, seat = null) {
  const items = Array.isArray(flashes) ? flashes : [];
  return items.filter((flash) => flash?.visibleToEnemy || (seat && flash?.teamSeat === seat));
}

export function pickRandomImperialSkill(rng = Math.random) {
  return WX_IMPERIAL_SKILLS[Math.floor(rng() * WX_IMPERIAL_SKILLS.length)] || null;
}

export function imperialGuardActive(team) {
  return Number(team?.effects?.imperialGuardUntil || 0) > Number(team?.match?.elapsed || 0);
}

export function imperialMightActive(team) {
  return Number(team?.effects?.imperialMightUntil || 0) > Number(team?.match?.elapsed || 0);
}

export function imperialGuardDamageTakenMultiplier(team) {
  return imperialGuardActive(team) ? IMPERIAL_GUARD_DAMAGE_TAKEN : 1;
}

export function imperialMightDamageMultiplier(team) {
  return imperialMightActive(team) ? IMPERIAL_MIGHT_DAMAGE : 1;
}
