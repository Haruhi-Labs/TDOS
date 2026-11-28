import { DAMAGE_KIND } from "../rules/damage.js";

const DAMAGE_KEYS = [...Object.values(DAMAGE_KIND), "unknown"];
const DEFAULT_SEATS = Object.freeze(["A", "B"]);

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

function normalizeTelemetrySeats(seatOrder = DEFAULT_SEATS) {
  if (!Array.isArray(seatOrder) || seatOrder.length === 0) {
    throw new TypeError("统计席位列表必须是非空数组");
  }
  const seen = new Set();
  const ordered = [];
  for (const seat of seatOrder) {
    if (typeof seat !== "string" || seat.length === 0) {
      throw new TypeError("统计席位必须是非空字符串");
    }
    if (seen.has(seat)) {
      throw new Error(`统计席位列表存在重复席位：${seat}`);
    }
    seen.add(seat);
    ordered.push(seat);
  }
  return Object.freeze(ordered);
}

function safeDamageKind(kind) {
  return DAMAGE_KEYS.includes(kind) ? kind : "unknown";
}

function roundedCounterMap(map) {
  return Object.fromEntries(
    Object.entries(map || {}).map(([key, value]) => [key, Math.round((Number(value) || 0) * 100) / 100]),
  );
}

// 事件记录与计数存储属于同一所有者，按注册席位建表，外部只能读取独立结算投影。
export class MatchTelemetry {
  #seatOrder;
  #teams;

  constructor(seatOrder = DEFAULT_SEATS) {
    this.#seatOrder = normalizeTelemetrySeats(seatOrder);
    this.#teams = new Map(this.#seatOrder.map((seat) => [seat, teamTelemetry()]));
  }

  #teamRow(seat) {
    return typeof seat === "string" && this.#teams.has(seat) ? this.#teams.get(seat) : null;
  }

  recordAction(seat, action) {
    const row = this.#teamRow(seat);
    const key = String(action || "unknown").slice(0, 40);
    if (!row || !key) return;
    row.actions[key] = (Number(row.actions[key]) || 0) + 1;
  }

  recordAttack(seat, kind, hitCount = 0) {
    const row = this.#teamRow(seat);
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
    const source = this.#teamRow(sourceSeat);
    const target = this.#teamRow(targetSeat);
    if (source) source.damageDealt[key] += value;
    if (target) target.damageTaken[key] += value;
  }

  recordShipLoss(seat) {
    const row = this.#teamRow(seat);
    if (row) row.shipsLost += 1;
  }

  serializeSeat(seat) {
    const row = this.#teamRow(seat);
    if (!row) return null;
    return {
      actions: { ...row.actions },
      attacks: { ...row.attacks },
      damageDealt: roundedCounterMap(row.damageDealt),
      damageTaken: roundedCounterMap(row.damageTaken),
      shipsLost: row.shipsLost,
    };
  }

  serialize() {
    return {
      teams: Object.fromEntries(this.#seatOrder.map((seat) => [seat, this.serializeSeat(seat)])),
    };
  }
}
