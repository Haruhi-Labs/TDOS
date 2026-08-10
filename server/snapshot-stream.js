import { SNAPSHOT_RATE } from "../shared/game/constants.js";
import { createStatePatch } from "../shared/network-patch.js";
import {
  CONGESTION_ACK_AGE_MS,
  CONGESTION_BUFFERED_BYTES,
  CONGESTION_INFLIGHT_SNAPSHOTS,
  MAX_DELTA_TO_FULL_RATIO,
  MAX_SNAPSHOT_BUFFERED_BYTES,
  PLAYER_STREAM_DIVISORS,
  SEVERE_CONGESTION_ACK_AGE_MS,
  SEVERE_CONGESTION_BUFFERED_BYTES,
  SEVERE_CONGESTION_INFLIGHT_SNAPSHOTS,
  SNAPSHOT_KEYFRAME_INTERVAL,
  SPECTATOR_STREAM_DIVISORS,
  STREAM_RECOVERY_STABLE_MS,
} from "./config.js";

export function createSnapshotStream({ networkStats }) {
  let nextSnapshotStreamPhase = 0;

  function send(ws, payload) {
    if (!ws || ws.readyState !== 1) {
      return;
    }
    ws.send(JSON.stringify(payload));
  }
  
  function sendToPlayer(player, payload) {
    if (!player) {
      return;
    }
    send(player.ws, payload);
  }
  
  function resetSnapshotStream(player) {
    if (!player) {
      return;
    }
    nextSnapshotStreamPhase += 1;
    player.snapshotStream = {
      sequence: 0,
      lastState: null,
      lastRoomSnapshotSeq: 0,
      lastKeyframeRoomSeq: 0,
      forceKeyframe: true,
      rateTier: 0,
      phase: nextSnapshotStreamPhase,
      lastDeliveryAckSeq: 0,
      lastDeliveryAckAt: Date.now(),
      healthySince: 0,
    };
  }
  
  function streamDivisors(options) {
    return options.spectating ? SPECTATOR_STREAM_DIVISORS : PLAYER_STREAM_DIVISORS;
  }
  
  function updateStreamCongestion(player, now, options) {
    const stream = player.snapshotStream;
    const bufferedBytes = Number(player.ws.bufferedAmount) || 0;
    const inFlight = Math.max(0, stream.sequence - stream.lastDeliveryAckSeq);
    // 已全部确认时没有在途数据，等待阶段即使很久没有新 ACK 也不属于拥塞。
    const ackAge = inFlight > 0 ? Math.max(0, now - stream.lastDeliveryAckAt) : 0;
    const severe =
      bufferedBytes >= SEVERE_CONGESTION_BUFFERED_BYTES ||
      inFlight >= SEVERE_CONGESTION_INFLIGHT_SNAPSHOTS ||
      ackAge >= SEVERE_CONGESTION_ACK_AGE_MS;
    const congested =
      severe ||
      bufferedBytes >= CONGESTION_BUFFERED_BYTES ||
      inFlight >= CONGESTION_INFLIGHT_SNAPSHOTS ||
      ackAge >= CONGESTION_ACK_AGE_MS;
    const maxTier = streamDivisors(options).length - 1;
    const previousTier = stream.rateTier;
  
    if (severe && stream.rateTier < maxTier) {
      stream.rateTier = maxTier;
      stream.healthySince = 0;
    } else if (congested && stream.rateTier < 1) {
      stream.rateTier = 1;
      stream.healthySince = 0;
    } else if (congested) {
      stream.healthySince = 0;
    } else {
      const healthy =
        bufferedBytes < 8 * 1024 &&
        inFlight <= 5 &&
        ackAge < 800;
      if (!healthy || stream.rateTier <= 0) {
        stream.healthySince = 0;
      } else if (!stream.healthySince) {
        stream.healthySince = now;
      } else if (now - stream.healthySince >= STREAM_RECOVERY_STABLE_MS) {
        stream.rateTier -= 1;
        stream.healthySince = 0;
      }
    }
    if (stream.rateTier !== previousTier) {
      networkStats.streamTierChanges += 1;
    }
  }
  
  function sendSnapshotToPlayer(player, frame, options = {}) {
    if (!player || !player.ws || player.ws.readyState !== 1) {
      return false;
    }
    // 战场快照是可替换状态，不应在慢连接上无限排队。积压超过阈值时直接跳过旧帧，
    // 等发送缓冲恢复后再下发最新快照，避免延迟从数百毫秒滚成数秒并拖高进程内存。
    if (player.ws.bufferedAmount > MAX_SNAPSHOT_BUFFERED_BYTES) {
      player.skippedSnapshots = (player.skippedSnapshots || 0) + 1;
      networkStats.skippedSnapshots += 1;
      if (player.snapshotStream) {
        player.snapshotStream.forceKeyframe = true;
      }
      return false;
    }
  
    if (!player.snapshotStream) {
      resetSnapshotStream(player);
    }
    const stream = player.snapshotStream;
    const now = Date.now();
    const supportsDeltaProtocol = Number(player.networkProtocolVersion) >= 2;
    if (supportsDeltaProtocol) {
      updateStreamCongestion(player, now, options);
    } else {
      stream.rateTier = 0;
      stream.healthySince = 0;
    }
    const divisors = streamDivisors(options);
    const divisor = divisors[Math.min(stream.rateTier, divisors.length - 1)];
    if (!stream.forceKeyframe && frame.roomSnapshotSeq % divisor !== stream.phase % divisor) {
      return false;
    }
    const snapshotSeq = stream.sequence + 1;
    const header = {
      roomId: frame.roomId,
      snapshotSeq,
      serverFrame: frame.roomSnapshotSeq,
      tick: frame.tick,
      simTime: frame.simTime,
      serverTime: frame.serverTime,
      snapshotRate: SNAPSHOT_RATE / divisor,
      streamTier: stream.rateTier,
      ackSeq: Number(options.ackSeq) || 0,
    };
    if (options.spectating) {
      header.spectating = true;
    }
    // 长门雷达属于席位私有的间接情报，不进入共享 state / 差量缓存；
    // 只有该长门玩家自己的快照消息头会携带，对手与观战者均收不到。
    if (options.radar) {
      header.radar = options.radar;
    }
    if (options.privateWxAnchor) {
      header.privateWxAnchor = options.privateWxAnchor;
    }
    if (Array.isArray(options.visibleComboFlashes)) {
      header.visibleComboFlashes = options.visibleComboFlashes;
    }
  
    const keyframeDue =
      !supportsDeltaProtocol ||
      stream.forceKeyframe ||
      !stream.lastState ||
      frame.roomSnapshotSeq - stream.lastKeyframeRoomSeq >= SNAPSHOT_KEYFRAME_INTERVAL;
    let serialized = null;
    let keyframe = keyframeDue;
  
    if (!keyframeDue) {
      const baseRoomSeq = stream.lastRoomSnapshotSeq;
      let patch = frame.patchCache.get(baseRoomSeq);
      if (!frame.patchCache.has(baseRoomSeq)) {
        // 同一房间、同一发送档位的连接拥有相同基线。差量树只计算一次，
        // 玩家与观战扇出时复用结果，避免连接数增加后重复遍历整份战场状态。
        patch = createStatePatch(stream.lastState, frame.state);
        frame.patchCache.set(baseRoomSeq, patch);
      }
      const deltaPayload = {
        type: "snapshot_delta",
        ...header,
        baseSnapshotSeq: stream.sequence,
        patch,
      };
      const deltaText = JSON.stringify(deltaPayload);
      const privateBytes = Buffer.byteLength(JSON.stringify({
        radar: options.radar || null,
        privateWxAnchor: options.privateWxAnchor || null,
        visibleComboFlashes: options.visibleComboFlashes || [],
      }));
      if (Buffer.byteLength(deltaText) <= (frame.stateBytes + privateBytes) * MAX_DELTA_TO_FULL_RATIO) {
        serialized = deltaText;
      } else {
        keyframe = true;
      }
    }
  
    if (!serialized) {
      serialized = JSON.stringify({
        type: "snapshot",
        ...header,
        state: frame.state,
      });
    }
  
    player.ws.send(serialized);
    networkStats.snapshotMessages += 1;
    networkStats.snapshotRawBytes += Buffer.byteLength(serialized);
    if (keyframe) {
      networkStats.keyframes += 1;
    } else {
      networkStats.deltas += 1;
    }
    stream.sequence = snapshotSeq;
    stream.lastState = frame.state;
    stream.lastRoomSnapshotSeq = frame.roomSnapshotSeq;
    stream.forceKeyframe = false;
    if (keyframe) {
      stream.lastKeyframeRoomSeq = frame.roomSnapshotSeq;
    }
    return true;
  }
  

  return { send, sendToPlayer, resetSnapshotStream, sendSnapshotToPlayer };
}
