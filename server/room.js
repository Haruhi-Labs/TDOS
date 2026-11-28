import { copyPlainData, freezePlainData } from "../shared/data/plain-data.js";
import { readonlyIdSet } from "../shared/data/readonly-id-set.js";
import { getRoomFormat } from "../shared/protocol/room-formats.js";

class SnapshotSchedule {
  #elapsed = 0;
  #sequence = 0;
  get elapsed() { return this.#elapsed; }
  get sequence() { return this.#sequence; }
  reset() { this.#elapsed = 0; this.#sequence = 0; }
  next() { return ++this.#sequence; }
  advance(dt, interval, send) {
    this.#elapsed += dt;
    while (this.#elapsed >= interval) {
      this.#elapsed -= interval;
      send();
    }
  }
}

function buildSeatRecord(seatOrder, source, defaultValue) {
  const record = {};
  for (const seat of seatOrder) {
    record[seat] = source && Object.hasOwn(source, seat) ? source[seat] : defaultValue;
  }
  return Object.freeze(record);
}

// 房间聚合独占成员、阵营归属与对局生命周期；调度器独占快照时钟，外部只能读取状态或提交领域命令。
export class Room {
  #format;
  #state;
  #seats;
  #ready;
  #spectators;
  #disconnectedSeats;
  #matchRoster;
  #schedule = new SnapshotSchedule();

  constructor({
    formatId = "duel",
    seats,
    ready,
    spectators = [],
    ...initial
  } = {}) {
    if (
      Object.hasOwn(initial, "snapshotSeq")
      || Object.hasOwn(initial, "snapshotAccumulator")
      || Object.hasOwn(initial, "disconnectedSeats")
      || Object.hasOwn(initial, "matchRoster")
    ) {
      throw new Error("快照调度或运行期成员状态不能从房间记录注入");
    }
    const format = getRoomFormat(formatId);
    if (!format) {
      throw new Error(`不支持的房间玩法格式：${String(formatId)}`);
    }
    this.#format = format;

    const defaults = {
      ownerId: null,
      status: "waiting",
      countdownEndsAt: null,
      startedAt: null,
      match: null,
      finishedAt: null,
      closesAt: null,
      result: null,
      aiLoadout: null,
      kind: "standard",
      formatId: format.formatId,
    };
    this.#state = { ...defaults, ...initial, formatId: format.formatId };
    this.#state.aiLoadout = freezePlainData(copyPlainData(this.#state.aiLoadout));
    this.#state.result = freezePlainData(copyPlainData(this.#state.result));
    this.#seats = buildSeatRecord(format.seats, seats, null);
    this.#ready = buildSeatRecord(format.seats, ready, false);
    this.#spectators = readonlyIdSet(spectators);
    this.#disconnectedSeats = readonlyIdSet([]);
    this.#matchRoster = null;
    for (const key of Object.keys(this.#state)) {
      Object.defineProperty(this, key, {
        enumerable: true,
        get: () => this.#state[key],
      });
    }
  }

  get format() { return this.#format; }
  get battleMode() { return this.#format.battleMode; }
  get stateSchema() { return this.#format.stateSchema; }
  get capacity() { return this.#format.capacity; }
  get seatOrder() { return this.#format.seats; }
  get seatSides() { return this.#format.seatSideMap; }
  get seats() { return this.#seats; }
  get ready() { return this.#ready; }
  get spectators() { return this.#spectators; }
  get disconnectedSeats() { return this.#disconnectedSeats; }
  get matchRoster() { return this.#matchRoster; }
  get snapshotAccumulator() { return this.#schedule.elapsed; }
  get snapshotSeq() { return this.#schedule.sequence; }
  nextSnapshotSequence() { return this.#schedule.next(); }
  advanceSnapshots(dt, interval, send) { this.#schedule.advance(dt, interval, send); }

  seatOfPlayer(playerId) {
    if (!playerId) return null;
    for (const seat of this.#format.seats) {
      if (this.#seats[seat] === playerId) return seat;
    }
    return null;
  }

  sideOfSeat(seat) {
    return Object.hasOwn(this.#format.seatSideMap, seat) ? this.#format.seatSideMap[seat] : null;
  }

  assignHost(playerId) {
    if (this.status !== "waiting" || this.kind !== "tournament" || this.ownerId) return false;
    this.#state.ownerId = playerId;
    return true;
  }

  assignOwner(playerId) {
    if (this.kind === "tournament") return false;
    if (playerId === null) {
      this.#state.ownerId = null;
      return true;
    }
    if (!playerId || !Object.values(this.#seats).includes(playerId)) return false;
    this.#state.ownerId = playerId;
    return true;
  }

  occupySeat(seat, playerId) {
    if (
      this.status !== "waiting"
      || !this.#format.seats.includes(seat)
      || !playerId
      || this.#seats[seat]
      || Object.values(this.#seats).includes(playerId)
      || this.#spectators.has(playerId)
    ) {
      return false;
    }
    this.#seats = Object.freeze({ ...this.#seats, [seat]: playerId });
    this.#ready = Object.freeze({ ...this.#ready, [seat]: false });
    return true;
  }

  switchSeat(fromSeat, toSeat, playerId) {
    if (
      this.status !== "waiting"
      || !this.#format.allowSideSwitch
      || !this.#format.seats.includes(fromSeat)
      || !this.#format.seats.includes(toSeat)
      || fromSeat === toSeat
      || !playerId
      || this.#seats[fromSeat] !== playerId
      || this.#seats[toSeat]
    ) {
      return false;
    }
    this.#seats = Object.freeze({
      ...this.#seats,
      [fromSeat]: null,
      [toSeat]: playerId,
    });
    this.#ready = Object.freeze({
      ...this.#ready,
      [fromSeat]: false,
      [toSeat]: false,
    });
    return true;
  }

  releaseSeat(playerId) {
    const seats = { ...this.#seats };
    let releasedSeat = null;
    for (const seat of this.#format.seats) {
      if (seats[seat] === playerId) {
        seats[seat] = null;
        releasedSeat = seat;
      }
    }
    let promoted = null;
    if (this.status === "waiting") {
      if (this.formatId === "duel" && this.kind === "standard") {
        if (!seats.A && seats.B) {
          promoted = seats.B;
          seats.A = seats.B;
          seats.B = null;
        }
      } else {
        this.#ready = buildSeatRecord(this.#format.seats, null, false);
      }
    } else if (this.status === "running" && this.formatId !== "duel" && releasedSeat) {
      this.#disconnectedSeats = readonlyIdSet([...this.#disconnectedSeats, releasedSeat]);
    }
    this.#seats = Object.freeze(seats);
    return promoted;
  }

  setReady(seat, playerId, ready) {
    if (
      this.status !== "waiting"
      || (this.kind !== "tournament" && !this.#format.requiresReady)
      || typeof ready !== "boolean"
      || !playerId
      || this.#seats[seat] !== playerId
    ) {
      return false;
    }
    this.#ready = Object.freeze({ ...this.#ready, [seat]: ready });
    return true;
  }

  addSpectator(playerId) {
    if (!playerId || Object.values(this.#seats).includes(playerId) || this.#spectators.has(playerId)) return false;
    this.#spectators = readonlyIdSet([...this.#spectators, playerId]);
    return true;
  }

  removeSpectator(playerId) {
    this.#spectators = readonlyIdSet([...this.#spectators].filter((id) => id !== playerId));
  }

  retainSpectators(ids) {
    this.#spectators = readonlyIdSet([...this.#spectators].filter((id) => ids.has(id)));
  }

  begin({ createMatch, countdownMs = 0, now = Date.now, matchRoster = null }) {
    if (this.status === "countdown" || this.status === "running") return false;
    const needsCountdown = this.mode === "pvp";
    this.#state.status = needsCountdown ? "countdown" : "running";
    this.#state.startedAt = now();
    this.#state.countdownEndsAt = needsCountdown ? now() + countdownMs : null;
    this.#state.match = createMatch();
    this.#schedule.reset();
    this.#state.finishedAt = null;
    this.#state.closesAt = null;
    this.#state.result = null;
    this.#disconnectedSeats = readonlyIdSet([]);
    this.#matchRoster = matchRoster ? freezePlainData(copyPlainData(matchRoster)) : null;
    return true;
  }

  startRunning(now) {
    if (this.status !== "countdown" || !this.match || now < Number(this.countdownEndsAt || 0)) return false;
    this.#state.status = "running";
    this.#state.countdownEndsAt = null;
    return true;
  }

  finish(now, delay, buildResult) {
    if (this.status !== "running" || this.match?.phase !== "finished") return false;
    this.#state.status = "finished";
    this.#state.finishedAt = now;
    this.#state.closesAt = now + delay;
    this.#state.result = freezePlainData(copyPlainData(buildResult(this, now)));
    return true;
  }
}
