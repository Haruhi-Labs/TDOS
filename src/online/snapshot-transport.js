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

export function createOnlineSnapshotTransport({ app, nowMs, socketSend, updateConnectionUi, log }) {
  function resetConnectionState() {
    app.pingMs = 0;
    app.jitterMs = 0;
    app.interpDelayMs = DEFAULT_INTERP_MS;
    app.pingSeq = 0;
    app.pendingPings.clear();
    app.rttVarianceMs = 0;
    app.bestClockRttMs = Infinity;
    app.clockOffsetMs = 0;
    app.clockReady = false;
    app.serverTickRate = 30;
    app.serverSnapshotRate = 20;
    app.networkProtocolVersion = 1;
    app.serverRulesetVersion = "";
    app.rulesetStatus = "pending";
    app.rulesetCompatible = false;
    app.snapshotIntervalMs = 1000 / app.serverSnapshotRate;
  }

  function resetMatchState() {
    app.snapshots = [];
    app.latestSnapshot = null;
    app.lastSnapshotTick = 0;
    app.lastSnapshotSeq = 0;
    app.decodedSnapshotState = null;
    app.decodedSnapshotSeq = 0;
    app.lastSnapshotAckSentAt = 0;
    app.lastAckedSnapshotSeq = 0;
    app.lastSnapshotArriveAtMs = 0;
    app.snapshotArrivalMs = 0;
    app.snapshotArrivalJitterMs = 0;
    app.snapshotLossRatio = 0;
    app.snapshotReorderRatio = 0;
  }

  function updateInterpolationDelay() {
    const baseBufferMs = Math.max(MIN_INTERP_MS, app.snapshotIntervalMs * 1.35);
    const latencyBudget = app.pingMs * 0.22;
    const jitterBudget = Math.max(app.rttVarianceMs, app.snapshotArrivalJitterMs, app.jitterMs) * 1.6;
    const lossBudget = app.snapshotLossRatio * app.snapshotIntervalMs * 1.6;
    const reorderBudget = app.snapshotReorderRatio * app.snapshotIntervalMs * 1.1;
    const target = baseBufferMs + latencyBudget + jitterBudget + lossBudget + reorderBudget + 20;
    const minDelay = Math.max(MIN_INTERP_MS, app.snapshotIntervalMs * 1.05);
    const maxDelay = Math.max(MAX_INTERP_MS, app.snapshotIntervalMs * 4.5);
    app.interpDelayMs = clamp(lerp(app.interpDelayMs, target, 0.28), minDelay, maxDelay);
    updateConnectionUi();
  }

  function sendPingProbe() {
    if (!app.connected) return;
    app.pingSeq += 1;
    const pingId = app.pingSeq;
    const clientTime = nowMs();
    app.pendingPings.set(pingId, clientTime);
    if (app.pendingPings.size > 40) {
      const oldestKey = app.pendingPings.keys().next().value;
      if (oldestKey !== undefined) app.pendingPings.delete(oldestKey);
    }
    socketSend({ type: "ping", pingId, clientTime });
  }

  function startPingLoop() {
    stopPingLoop();
    sendPingProbe();
    app.pingTimer = window.setInterval(sendPingProbe, PING_INTERVAL_MS);
  }

  function stopPingLoop() {
    if (app.pingTimer) {
      clearInterval(app.pingTimer);
      app.pingTimer = null;
    }
    app.pendingPings.clear();
  }

  function handlePong(message) {
    const receivedClientMs = nowMs();
    const pingId = Number(message.pingId);
    const fallbackSentMs = Number(message.clientTime) || 0;
    let sentClientMs = fallbackSentMs;
    if (Number.isInteger(pingId) && app.pendingPings.has(pingId)) {
      sentClientMs = app.pendingPings.get(pingId);
      app.pendingPings.delete(pingId);
    }
    if (!sentClientMs) return;
    const roundTripTime = receivedClientMs - sentClientMs;
    if (!Number.isFinite(roundTripTime) || roundTripTime <= 0 || roundTripTime > 5000) return;

    if (!Number.isFinite(app.pingMs) || app.pingMs <= 0) {
      app.pingMs = roundTripTime;
    } else {
      app.rttVarianceMs = lerp(app.rttVarianceMs, Math.abs(roundTripTime - app.pingMs), 0.22);
      app.pingMs = lerp(app.pingMs, roundTripTime, 0.28);
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
      app.bestClockRttMs = Math.min(app.bestClockRttMs + 0.2, roundTripTime);
      if (!app.clockReady) {
        app.clockOffsetMs = offsetSample;
        app.clockReady = true;
      } else {
        const tightSample = roundTripTime <= app.bestClockRttMs + 8;
        app.clockOffsetMs = lerp(app.clockOffsetMs, offsetSample, tightSample ? 0.2 : 0.06);
      }
    }

    app.jitterMs = lerp(app.jitterMs, Math.max(app.rttVarianceMs, app.snapshotArrivalJitterMs), 0.18);
    updateInterpolationDelay();
  }

  function handleConnected(message) {
    app.playerId = message.playerId || null;
    const build = String(message.build || "").trim();
    log(build ? t("服务器版本：{build}", { build }) : t("服务器版本信息缺失，可能仍在运行旧版服务端"));

    const tickRate = Number(message.tickRate);
    const snapshotRate = Number(message.snapshotRate);
    const snapshotIntervalMs = Number(message.snapshotIntervalMs);
    const protocolVersion = Number(message.protocolVersion);
    const rulesetCompatibility = evaluateRulesetCompatibility(message.rulesetVersion);
    app.serverRulesetVersion = rulesetCompatibility.remoteVersion;
    app.rulesetStatus = rulesetCompatibility.status;
    app.rulesetCompatible = rulesetCompatibility.compatible;
    if (rulesetCompatibility.status === "legacy") {
      log(t("服务器未声明规则版本，将使用旧版兼容模式"));
    } else if (!rulesetCompatibility.compatible) {
      log(t("规则版本不兼容：客户端 {client}，服务器 {server}", {
        client: RULESET_VERSION,
        server: rulesetCompatibility.remoteVersion,
      }));
    }
    app.networkProtocolVersion = Number.isInteger(protocolVersion) && protocolVersion >= 2 ? protocolVersion : 1;
    if (Number.isFinite(tickRate) && tickRate >= 5) app.serverTickRate = tickRate;
    if (Number.isFinite(snapshotRate) && snapshotRate >= 2) {
      app.serverSnapshotRate = snapshotRate;
      app.snapshotIntervalMs = 1000 / app.serverSnapshotRate;
    } else if (Number.isFinite(snapshotIntervalMs) && snapshotIntervalMs >= 15) {
      app.snapshotIntervalMs = snapshotIntervalMs;
    }

    const serverTime = Number(message.serverTime);
    if (Number.isFinite(serverTime)) {
      app.clockOffsetMs = serverTime - nowMs();
      app.clockReady = true;
    }
    if (app.networkProtocolVersion >= 2) {
      socketSend({
        type: "protocol_hello",
        protocolVersion: 2,
        rulesetVersion: RULESET_VERSION,
      });
    }
    updateInterpolationDelay();
  }

  function updateSnapshotStats(snapshot) {
    if (app.lastSnapshotArriveAtMs > 0) {
      const arrivalGap = Math.max(0, snapshot.receivedAtMs - app.lastSnapshotArriveAtMs);
      app.snapshotArrivalMs = app.snapshotArrivalMs <= 0
        ? arrivalGap
        : lerp(app.snapshotArrivalMs, arrivalGap, 0.16);
      app.snapshotArrivalJitterMs = lerp(
        app.snapshotArrivalJitterMs,
        Math.abs(arrivalGap - app.snapshotIntervalMs),
        0.24,
      );
    }
    app.lastSnapshotArriveAtMs = snapshot.receivedAtMs;

    if (snapshot.tick < app.lastSnapshotTick) {
      app.snapshotReorderRatio = lerp(app.snapshotReorderRatio, 1, 0.16);
    } else {
      app.snapshotReorderRatio = lerp(app.snapshotReorderRatio, 0, 0.06);
      app.lastSnapshotTick = Math.max(app.lastSnapshotTick, snapshot.tick);
    }

    if (snapshot.snapshotSeq > 0) {
      if (app.lastSnapshotSeq > 0) {
        if (snapshot.snapshotSeq <= app.lastSnapshotSeq) {
          app.snapshotReorderRatio = lerp(app.snapshotReorderRatio, 1, 0.22);
        } else {
          const lost = Math.max(0, snapshot.snapshotSeq - app.lastSnapshotSeq - 1);
          app.snapshotLossRatio = lerp(app.snapshotLossRatio, lost > 0 ? clamp(lost / 3, 0, 1) : 0, 0.22);
        }
      }
      app.lastSnapshotSeq = Math.max(app.lastSnapshotSeq, snapshot.snapshotSeq);
    } else {
      app.snapshotLossRatio = lerp(app.snapshotLossRatio, 0, 0.04);
    }
    app.jitterMs = lerp(app.jitterMs, Math.max(app.rttVarianceMs, app.snapshotArrivalJitterMs), 0.16);
  }

  function insertSnapshot(snapshot) {
    const existingIndex = app.snapshots.findIndex((item) => item.tick === snapshot.tick);
    if (existingIndex >= 0) app.snapshots[existingIndex] = snapshot;
    else app.snapshots.push(snapshot);
    app.snapshots.sort((left, right) => left.tick !== right.tick
      ? left.tick - right.tick
      : left.receivedAtMs - right.receivedAtMs);

    const latest = app.snapshots[app.snapshots.length - 1] || null;
    app.latestSnapshot = latest;
    if (!latest) return;
    const minimumTick = Math.max(0, latest.tick - Math.ceil(app.serverTickRate * SNAPSHOT_HISTORY_SECONDS));
    while (app.snapshots.length > 0 && app.snapshots[0].tick < minimumTick) app.snapshots.shift();
    if (app.snapshots.length > 260) app.snapshots.splice(0, app.snapshots.length - 260);
  }

  function decodeSnapshotState(message) {
    const snapshotSeq = Number(message.snapshotSeq) || 0;
    if (message.type === "snapshot") {
      if (!message.state || typeof message.state !== "object") return null;
      app.decodedSnapshotState = message.state;
      app.decodedSnapshotSeq = snapshotSeq;
      return message.state;
    }
    if (message.type !== "snapshot_delta") return null;

    const baseSnapshotSeq = Number(message.baseSnapshotSeq) || 0;
    if (!app.decodedSnapshotState || baseSnapshotSeq !== app.decodedSnapshotSeq) {
      socketSend({ type: "snapshot_resync", snapshotSeq: app.decodedSnapshotSeq });
      return null;
    }
    try {
      app.decodedSnapshotState = applyStatePatch(app.decodedSnapshotState, message.patch ?? null);
      app.decodedSnapshotSeq = snapshotSeq;
      return app.decodedSnapshotState;
    } catch (_error) {
      app.decodedSnapshotState = null;
      app.decodedSnapshotSeq = 0;
      socketSend({ type: "snapshot_resync", snapshotSeq: 0 });
      return null;
    }
  }

  function sendSnapshotDeliveryAck(snapshotSeq, force = false) {
    if (app.networkProtocolVersion < 2 || !Number.isInteger(snapshotSeq) || snapshotSeq <= 0) return;
    const currentTime = nowMs();
    if (!force && currentTime - app.lastSnapshotAckSentAt < SNAPSHOT_ACK_INTERVAL_MS) return;
    if (socketSend({ type: "snapshot_ack", snapshotSeq })) {
      app.lastSnapshotAckSentAt = currentTime;
      app.lastAckedSnapshotSeq = snapshotSeq;
    }
  }

  function receiveSnapshot(message) {
    const snapshotRate = Number(message.snapshotRate);
    if (Number.isFinite(snapshotRate) && snapshotRate >= 2 && snapshotRate !== app.serverSnapshotRate) {
      app.serverSnapshotRate = snapshotRate;
      app.snapshotIntervalMs = 1000 / snapshotRate;
    }
    const decodedState = decodeSnapshotState(message);
    if (!decodedState) return null;
    let state = decodedState;
    if (!message.spectating && app.seat && decodedState.teams?.[app.seat]) {
      state = {
        ...decodedState,
        comboFlashes: Array.isArray(message.visibleComboFlashes)
          ? message.visibleComboFlashes
          : decodedState.comboFlashes,
        teams: {
          ...decodedState.teams,
          [app.seat]: {
            ...decodedState.teams[app.seat],
            wxAnchor: message.privateWxAnchor || decodedState.teams[app.seat].wxAnchor,
          },
        },
      };
    }

    const snapshotSeq = Number(message.snapshotSeq) || 0;
    sendSnapshotDeliveryAck(snapshotSeq, message.type === "snapshot");
    const simulationTime = Number(message.simTime) || 0;
    const tickValue = Number(message.tick);
    const tick = Number.isFinite(tickValue) && tickValue > 0
      ? Math.round(tickValue)
      : Math.max(0, Math.round(simulationTime * app.serverTickRate));
    const snapshot = {
      tick,
      simTime: simulationTime,
      serverTimeMs: Number(message.serverTime) || 0,
      snapshotSeq,
      receivedAtMs: nowMs(),
      state,
      radar: message.radar || null,
    };
    updateSnapshotStats(snapshot);
    insertSnapshot(snapshot);
    return snapshot;
  }

  return {
    handleConnected,
    handlePong,
    receiveSnapshot,
    resetConnectionState,
    resetMatchState,
    startPingLoop,
    stopPingLoop,
    updateInterpolationDelay,
  };
}
