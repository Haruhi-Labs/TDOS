import { DAMAGE_KIND } from "./damage.js";

const DAMAGE_KEYS = [...Object.values(DAMAGE_KIND), "unknown"];

function counterMap(keys = []) {
  return Object.fromEntries(keys.map((key) => [key, 0]));
}

function teamTelemetry() {
  return {
    actions: {},
    attacks: {
      projectileFired: 0,
      projectileHits: 0,
      beamFired: 0,
      beamHits: 0,
    },
    damageDealt: counterMap(DAMAGE_KEYS),
    damageTaken: counterMap(DAMAGE_KEYS),
    shipsLost: 0,
  };
}

function teamRow(telemetry, seat) {
  return seat === "A" || seat === "B" ? telemetry.teams[seat] : null;
}

function safeDamageKind(kind) {
  return DAMAGE_KEYS.includes(kind) ? kind : "unknown";
}

export function createMatchTelemetry() {
  return {
    teams: {
      A: teamTelemetry(),
      B: teamTelemetry(),
    },
  };
}

export function recordTelemetryAction(telemetry, seat, action) {
  const row = teamRow(telemetry, seat);
  const key = String(action || "unknown").slice(0, 40);
  if (!row || !key) return;
  row.actions[key] = (Number(row.actions[key]) || 0) + 1;
}

export function recordTelemetryAttack(telemetry, seat, kind, hitCount = 0) {
  const row = teamRow(telemetry, seat);
  if (!row) return;
  if (kind === "beam") {
    row.attacks.beamFired += 1;
    row.attacks.beamHits += Math.max(0, Number(hitCount) || 0);
    return;
  }
  if (kind === "projectile_hit") {
    row.attacks.projectileHits += 1;
    return;
  }
  row.attacks.projectileFired += 1;
}

export function recordTelemetryDamage(telemetry, sourceSeat, targetSeat, amount, kind) {
  const value = Math.max(0, Number(amount) || 0);
  if (value <= 0) return;
  const key = safeDamageKind(kind);
  const source = teamRow(telemetry, sourceSeat);
  const target = teamRow(telemetry, targetSeat);
  if (source) source.damageDealt[key] += value;
  if (target) target.damageTaken[key] += value;
}

export function recordTelemetryShipLoss(telemetry, seat) {
  const row = teamRow(telemetry, seat);
  if (row) row.shipsLost += 1;
}

function roundedCounterMap(map) {
  return Object.fromEntries(
    Object.entries(map || {}).map(([key, value]) => [key, Math.round((Number(value) || 0) * 100) / 100]),
  );
}

export function serializeMatchTelemetry(telemetry) {
  return {
    teams: Object.fromEntries(["A", "B"].map((seat) => {
      const row = teamRow(telemetry, seat) || teamTelemetry();
      return [seat, {
        actions: { ...row.actions },
        attacks: { ...row.attacks },
        damageDealt: roundedCounterMap(row.damageDealt),
        damageTaken: roundedCounterMap(row.damageTaken),
        shipsLost: row.shipsLost,
      }];
    })),
  };
}
