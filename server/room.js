import { copyPlainData, freezePlainData } from "../shared/data/plain-data.js";
import { readonlyIdSet } from "../shared/data/readonly-id-set.js";

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

// 房间聚合独占成员和比赛生命周期；调度器独占快照时钟，外部只能读取状态或提交领域命令。
export class Room {
  #state;
  #seats;
  #ready;
  #spectators;
  #schedule = new SnapshotSchedule();
  constructor({ seats = { A: null, B: null }, ready = { A: false, B: false }, spectators = [], ...initial }) {
    if (Object.hasOwn(initial, "snapshotSeq") || Object.hasOwn(initial, "snapshotAccumulator")) throw new Error("快照调度状态不能从房间记录注入");
    const defaults = { ownerId: null, status: "waiting", countdownEndsAt: null, startedAt: null,
      match: null, finishedAt: null, closesAt: null, result: null, aiLoadout: null, kind: "standard" };
    this.#state = { ...defaults, ...initial };
    this.#state.aiLoadout = freezePlainData(copyPlainData(this.#state.aiLoadout));
    this.#state.result = freezePlainData(copyPlainData(this.#state.result));
    this.#seats = Object.freeze({ ...seats });
    this.#ready = Object.freeze({ ...ready });
    this.#spectators = readonlyIdSet(spectators);
    for (const key of Object.keys(this.#state)) Object.defineProperty(this, key, {
      enumerable: true, get: () => this.#state[key],
    });
  }
  get seats() { return this.#seats; }
  get ready() { return this.#ready; }
  get spectators() { return this.#spectators; }
  get snapshotAccumulator() { return this.#schedule.elapsed; }
  get snapshotSeq() { return this.#schedule.sequence; }
  nextSnapshotSequence() { return this.#schedule.next(); }
  advanceSnapshots(dt, interval, send) { this.#schedule.advance(dt, interval, send); }

  assignHost(playerId) {
    if (this.status !== "waiting" || this.kind !== "tournament" || this.ownerId) return false;
    this.#state.ownerId = playerId;
    return true;
  }
  occupySeat(seat, playerId) {
    if (this.status !== "waiting" || !["A", "B"].includes(seat) || !playerId
      || this.#seats[seat] || Object.values(this.#seats).includes(playerId) || this.#spectators.has(playerId)) return false;
    this.#seats = Object.freeze({ ...this.#seats, [seat]: playerId });
    this.#ready = Object.freeze({ ...this.#ready, [seat]: false });
    return true;
  }
  releaseSeat(playerId) {
    const seats = { ...this.#seats };
    for (const seat of ["A", "B"]) if (seats[seat] === playerId) seats[seat] = null;
    let promoted = null;
    if (this.status === "waiting") {
      if (this.kind === "tournament") this.#ready = Object.freeze({ A: false, B: false });
      else if (!seats.A && seats.B) { promoted = seats.B; seats.A = seats.B; seats.B = null; }
    }
    this.#seats = Object.freeze(seats);
    return promoted;
  }
  setReady(seat, playerId, ready) {
    if (this.status !== "waiting" || this.kind !== "tournament" || typeof ready !== "boolean"
      || !playerId || this.#seats[seat] !== playerId) return false;
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
  begin({ createMatch, countdownMs = 0, now = Date.now }) {
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
