import { DAMAGE_KIND } from "../rules/damage.js";

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

function roundedCounterMap(map) {
  return Object.fromEntries(
    Object.entries(map || {}).map(([key, value]) => [key, Math.round((Number(value) || 0) * 100) / 100]),
  );
}

// 事件记录与计数存储属于同一所有者，外部只能读取独立结算投影。
export class MatchTelemetry {
  #state = { teams: { A: teamTelemetry(), B: teamTelemetry() } };

  recordAction(seat, action) {
    const row = teamRow(this.#state, seat);
    const key = String(action || "unknown").slice(0, 40);
    if (!row || !key) return;
    row.actions[key] = (Number(row.actions[key]) || 0) + 1;
  }

  recordAttack(seat, kind, hitCount = 0) {
    const row = teamRow(this.#state, seat);
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

  recordDamage(sourceSeat, targetSeat, amount, kind) {
    const value = Math.max(0, Number(amount) || 0);
    if (value <= 0) return;
    const key = safeDamageKind(kind);
    const source = teamRow(this.#state, sourceSeat);
    const target = teamRow(this.#state, targetSeat);
    if (source) source.damageDealt[key] += value;
    if (target) target.damageTaken[key] += value;
  }

  recordShipLoss(seat) {
    const row = teamRow(this.#state, seat);
    if (row) row.shipsLost += 1;
  }

  serialize() {
    return {
      teams: Object.fromEntries(["A", "B"].map((seat) => {
        const row = teamRow(this.#state, seat) || teamTelemetry();
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
}
