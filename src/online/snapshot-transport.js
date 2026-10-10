import { freezePlainData } from "../../shared/data/plain-data.js";
import { clamp, lerp } from "../../shared/game/math.js";
import { applyStatePatch } from "../../shared/network-patch.js";
import {
  evaluateRulesetCompatibility,
  RULESET_VERSION,
} from "../../shared/protocol/ruleset-version.js";
import { t } from "../i18n.js";

export const DEFAULT_INTERP_MS = 120;
const MIN_INTERP_MS = 75;
const MAX_INTERP_MS = 280;
const SNAPSHOT_HISTORY_SECONDS = 6;
const PING_INTERVAL_MS = 1000;
const SNAPSHOT_ACK_INTERVAL_MS = 250;

export function createOnlineSnapshotTransport({ nowMs, socketSend, updateConnectionUi, log, isConnected = () => false, onPlayerId = () => {} }) {
  // 连接时钟、收包历史与差量基线只由传输模块持有。
  const state = { pendingPings: new Map(), pingTimer: null };

  function resetConnectionState() {
    state.pingMs = 0;
    state.jitterMs = 0;
    state.interpDelayMs = DEFAULT_INTERP_MS;
    state.pingSeq = 0;
    state.pendingPings.clear();
    state.rttVarianceMs = 0;
    state.bestClockRttMs = Infinity;
    state.clockOffsetMs = 0;
    state.clockReady = false;
    state.serverTickRate = 30;
    state.serverSnapshotRate = 20;
    state.networkProtocolVersion = 1;
    state.serverRulesetVersion = "";
    state.rulesetStatus = "pending";
    state.rulesetCompatible = false;
    state.snapshotIntervalMs = 1000 / state.serverSnapshotRate;
  }

  function resetMatchState() {
    state.snapshots = [];
    state.latestSnapshot = null;
    state.lastSnapshotTick = 0;
    state.lastSnapshotSeq = 0;
    state.decodedSnapshotState = null;
    state.decodedSnapshotSeq = 0;
    state.lastSnapshotAckSentAt = 0;
    state.lastAckedSnapshotSeq = 0;
    state.lastSnapshotArriveAtMs = 0;
    state.snapshotArrivalMs = 0;
    state.snapshotArrivalJitterMs = 0;
    state.snapshotLossRatio = 0;
    state.snapshotReorderRatio = 0;
  }

  function updateInterpolationDelay() {
    const baseBufferMs = Math.max(MIN_INTERP_MS, state.snapshotIntervalMs * 1.35);
    const latencyBudget = state.pingMs * 0.22;
    const jitterBudget = Math.max(state.rttVarianceMs, state.snapshotArrivalJitterMs, state.jitterMs) * 1.6;
    const lossBudget = state.snapshotLossRatio * state.snapshotIntervalMs * 1.6;
    const reorderBudget = state.snapshotReorderRatio * state.snapshotIntervalMs * 1.1;
    const target = baseBufferMs + latencyBudget + jitterBudget + lossBudget + reorderBudget + 20;
    const minDelay = Math.max(MIN_INTERP_MS, state.snapshotIntervalMs * 1.05);
    const maxDelay = Math.max(MAX_INTERP_MS, state.snapshotIntervalMs * 4.5);
    state.interpDelayMs = clamp(lerp(state.interpDelayMs, target, 0.28), minDelay, maxDelay);
    updateConnectionUi();
  }

  function sendPingProbe() {
    if (!isConnected()) return;
    state.pingSeq += 1;
    const pingId = state.pingSeq;
    const clientTime = nowMs();
    state.pendingPings.set(pingId, clientTime);
    if (state.pendingPings.size > 40) {
      const oldestKey = state.pendingPings.keys().next().value;
      if (oldestKey !== undefined) state.pendingPings.delete(oldestKey);
    }
    socketSend({ type: "ping", pingId, clientTime });
  }

  function startPingLoop() {
    stopPingLoop();
    sendPingProbe();
    state.pingTimer = window.setInterval(sendPingProbe, PING_INTERVAL_MS);
  }

  function stopPingLoop() {
    if (state.pingTimer) {
      clearInterval(state.pingTimer);
      state.pingTimer = null;
    }
    state.pendingPings.clear();
  }

  function handlePong(message) {
    const receivedClientMs = nowMs();
    const pingId = Number(message.pingId);
    const fallbackSentMs = Number(message.clientTime) || 0;
    let sentClientMs = fallbackSentMs;
    if (Number.isInteger(pingId) && state.pendingPings.has(pingId)) {
      sentClientMs = state.pendingPings.get(pingId);
      state.pendingPings.delete(pingId);
    }
    if (!sentClientMs) return;
    const roundTripTime = receivedClientMs - sentClientMs;
    if (!Number.isFinite(roundTripTime) || roundTripTime <= 0 || roundTripTime > 5000) return;

    if (!Number.isFinite(state.pingMs) || state.pingMs <= 0) {
      state.pingMs = roundTripTime;
    } else {
      state.rttVarianceMs = lerp(state.rttVarianceMs, Math.abs(roundTripTime - state.pingMs), 0.22);
      state.pingMs = lerp(state.pingMs, roundTripTime, 0.28);
    }

    const serverReceivedMs = Number(message.serverRecvTime);
    const serverSentMs = Number(message.serverSendTime);
    const serverTimeMs = Number(message.serverTime);
    let offsetSample = null;
    if (Number.isFinite(serverReceivedMs) && Number.isFinite(serverSentMs)) {
      offsetSample = ((serverReceivedMs - sentClientMs) + (serverSentMs - receivedClientMs)) * 0.5;
    } else if (Number.isFinite(serverTimeMs)) {
      offsetSample = serverTimeMs + roundTripTime * 0.5 - receivedClientMs;
    }

    if (Number.isFinite(offsetSample)) {
      state.bestClockRttMs = Math.min(state.bestClockRttMs + 0.2, roundTripTime);
      if (!state.clockReady) {
        state.clockOffsetMs = offsetSample;
        state.clockReady = true;
      } else {
        const tightSample = roundTripTime <= state.bestClockRttMs + 8;
        state.clockOffsetMs = lerp(state.clockOffsetMs, offsetSample, tightSample ? 0.2 : 0.06);
      }
    }

    state.jitterMs = lerp(state.jitterMs, Math.max(state.rttVarianceMs, state.snapshotArrivalJitterMs), 0.18);
    updateInterpolationDelay();
  }

  function handleConnected(message) {
    onPlayerId(message.playerId || null);
    const build = String(message.build || "").trim();
    log(build ? t("服务器版本：{build}", { build }) : t("服务器版本信息缺失，可能仍在运行旧版服务端"));

    const tickRate = Number(message.tickRate);
    const snapshotRate = Number(message.snapshotRate);
    const snapshotIntervalMs = Number(message.snapshotIntervalMs);
    const protocolVersion = Number(message.protocolVersion);
    const rulesetCompatibility = evaluateRulesetCompatibility(message.rulesetVersion);
    state.serverRulesetVersion = rulesetCompatibility.remoteVersion;
    state.rulesetStatus = rulesetCompatibility.status;
    state.rulesetCompatible = rulesetCompatibility.compatible;
    if (rulesetCompatibility.status === "legacy") {
      log(t("服务器未声明规则版本，将使用旧版兼容模式"));
    } else if (!rulesetCompatibility.compatible) {
      log(t("规则版本不兼容：客户端 {client}，服务器 {server}", {
        client: RULESET_VERSION,
        server: rulesetCompatibility.remoteVersion,
      }));
    }
    state.networkProtocolVersion = Number.isInteger(protocolVersion) && protocolVersion >= 2 ? protocolVersion : 1;
    if (Number.isFinite(tickRate) && tickRate >= 5) state.serverTickRate = tickRate;
    if (Number.isFinite(snapshotRate) && snapshotRate >= 2) {
      state.serverSnapshotRate = snapshotRate;
      state.snapshotIntervalMs = 1000 / state.serverSnapshotRate;
    } else if (Number.isFinite(snapshotIntervalMs) && snapshotIntervalMs >= 15) {
      state.snapshotIntervalMs = snapshotIntervalMs;
    }

    const serverTime = Number(message.serverTime);
    if (Number.isFinite(serverTime)) {
      state.clockOffsetMs = serverTime - nowMs();
      state.clockReady = true;
    }
    if (state.networkProtocolVersion >= 2) {
      socketSend({
        type: "protocol_hello",
        roomKinds: ["standard", "tournament"],
        protocolVersion: 2,
        rulesetVersion: RULESET_VERSION,
      });
    }
    updateInterpolationDelay();
  }

  function handleRulesetMismatch(message) {
    state.rulesetCompatible = false;
    state.rulesetStatus = "mismatch";
    state.serverRulesetVersion = String(message.serverRulesetVersion || state.serverRulesetVersion || "");
  }

  function updateSnapshotStats(snapshot) {
    if (state.lastSnapshotArriveAtMs > 0) {
      const arrivalGap = Math.max(0, snapshot.receivedAtMs - state.lastSnapshotArriveAtMs);
      state.snapshotArrivalMs = state.snapshotArrivalMs <= 0
        ? arrivalGap
        : lerp(state.snapshotArrivalMs, arrivalGap, 0.16);
      state.snapshotArrivalJitterMs = lerp(
        state.snapshotArrivalJitterMs,
        Math.abs(arrivalGap - state.snapshotIntervalMs),
        0.24,
      );
    }
    state.lastSnapshotArriveAtMs = snapshot.receivedAtMs;

    if (snapshot.tick < state.lastSnapshotTick) {
      state.snapshotReorderRatio = lerp(state.snapshotReorderRatio, 1, 0.16);
    } else {
      state.snapshotReorderRatio = lerp(state.snapshotReorderRatio, 0, 0.06);
      state.lastSnapshotTick = Math.max(state.lastSnapshotTick, snapshot.tick);
    }

    if (snapshot.snapshotSeq > 0) {
      if (state.lastSnapshotSeq > 0) {
        if (snapshot.snapshotSeq <= state.lastSnapshotSeq) {
          state.snapshotReorderRatio = lerp(state.snapshotReorderRatio, 1, 0.22);
        } else {
          const lost = Math.max(0, snapshot.snapshotSeq - state.lastSnapshotSeq - 1);
          state.snapshotLossRatio = lerp(state.snapshotLossRatio, lost > 0 ? clamp(lost / 3, 0, 1) : 0, 0.22);
        }
      }
      state.lastSnapshotSeq = Math.max(state.lastSnapshotSeq, snapshot.snapshotSeq);
    } else {
      state.snapshotLossRatio = lerp(state.snapshotLossRatio, 0, 0.04);
    }
    state.jitterMs = lerp(state.jitterMs, Math.max(state.rttVarianceMs, state.snapshotArrivalJitterMs), 0.16);
  }

  function insertSnapshot(snapshot) {
    const existingIndex = state.snapshots.findIndex((item) => item.tick === snapshot.tick);
    if (existingIndex >= 0) state.snapshots[existingIndex] = snapshot;
    else state.snapshots.push(snapshot);
    state.snapshots.sort((left, right) => left.tick !== right.tick
      ? left.tick - right.tick
      : left.receivedAtMs - right.receivedAtMs);

    const latest = state.snapshots[state.snapshots.length - 1] || null;
    state.latestSnapshot = latest;
    if (!latest) return;
    const minimumTick = Math.max(0, latest.tick - Math.ceil(state.serverTickRate * SNAPSHOT_HISTORY_SECONDS));
    while (state.snapshots.length > 0 && state.snapshots[0].tick < minimumTick) state.snapshots.shift();
    if (state.snapshots.length > 260) state.snapshots.splice(0, state.snapshots.length - 260);
  }

  function decodeSnapshotState(message) {
    const snapshotSeq = Number(message.snapshotSeq) || 0;
    if (message.type === "snapshot") {
      if (!message.state || typeof message.state !== "object") return null;
      state.decodedSnapshotState = freezePlainData(message.state);
      state.decodedSnapshotSeq = snapshotSeq;
      return message.state;
    }
    if (message.type !== "snapshot_delta") return null;

    const baseSnapshotSeq = Number(message.baseSnapshotSeq) || 0;
    if (!state.decodedSnapshotState || baseSnapshotSeq !== state.decodedSnapshotSeq) {
      socketSend({ type: "snapshot_resync", snapshotSeq: state.decodedSnapshotSeq });
      return null;
    }
    try {
      state.decodedSnapshotState = freezePlainData(applyStatePatch(state.decodedSnapshotState, message.patch ?? null));
      state.decodedSnapshotSeq = snapshotSeq;
      return state.decodedSnapshotState;
    } catch (_error) {
      state.decodedSnapshotState = null;
      state.decodedSnapshotSeq = 0;
      socketSend({ type: "snapshot_resync", snapshotSeq: 0 });
      return null;
    }
  }

  function sendSnapshotDeliveryAck(snapshotSeq, force = false) {
    if (state.networkProtocolVersion < 2 || !Number.isInteger(snapshotSeq) || snapshotSeq <= 0) return;
    const currentTime = nowMs();
    if (!force && currentTime - state.lastSnapshotAckSentAt < SNAPSHOT_ACK_INTERVAL_MS) return;
    if (socketSend({ type: "snapshot_ack", snapshotSeq })) {
      state.lastSnapshotAckSentAt = currentTime;
      state.lastAckedSnapshotSeq = snapshotSeq;
    }
  }

  function receiveSnapshot(message) {
    const snapshotRate = Number(message.snapshotRate);
    if (Number.isFinite(snapshotRate) && snapshotRate >= 2 && snapshotRate !== state.serverSnapshotRate) {
      state.serverSnapshotRate = snapshotRate;
      state.snapshotIntervalMs = 1000 / snapshotRate;
    }
    const decodedState = decodeSnapshotState(message);
    if (!decodedState) return null;

    const snapshotSeq = Number(message.snapshotSeq) || 0;
    sendSnapshotDeliveryAck(snapshotSeq, message.type === "snapshot");
    const simulationTime = Number(message.simTime) || 0;
    const tickValue = Number(message.tick);
    const tick = Number.isFinite(tickValue) && tickValue > 0
      ? Math.round(tickValue)
      : Math.max(0, Math.round(simulationTime * state.serverTickRate));
    const snapshot = {
      tick,
      simTime: simulationTime,
      serverTimeMs: Number(message.serverTime) || 0,
      snapshotSeq,
      receivedAtMs: nowMs(),
      state: decodedState,
      radar: freezePlainData(message.radar || null),
    };
    Object.freeze(snapshot);
    updateSnapshotStats(snapshot);
    insertSnapshot(snapshot);
    return snapshot;
  }

  resetConnectionState();
  resetMatchState();
  const publicKeys = Object.keys(state).filter((key) => !["pendingPings", "pingTimer", "decodedSnapshotState"].includes(key));
  const readState = Object.freeze(Object.defineProperties({}, Object.fromEntries(publicKeys.map((key) => [key, {
    enumerable: true,
    get: () => key === "snapshots" ? Object.freeze([...state.snapshots]) : state[key],
  }]))));

  function pruneBefore(targetTick) {
    while (state.snapshots.length > 4 && state.snapshots[1].tick < targetTick - state.serverTickRate * 0.6) {
      state.snapshots.shift();
    }
  }

  return {
    state: readState,
    pruneBefore,
    sendPingProbe,
    handleConnected,
    handleRulesetMismatch,
    handlePong,
    receiveSnapshot,
    resetConnectionState,
    resetMatchState,
    startPingLoop,
    stopPingLoop,
    updateInterpolationDelay,
  };
}
