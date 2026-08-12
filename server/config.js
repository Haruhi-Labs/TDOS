import { SNAPSHOT_RATE } from "../shared/game/constants.js";
import { resolve } from "node:path";

function envInteger(name, fallback, min, max) {
  const value = Number(process.env[name]);
  return Number.isInteger(value) && value >= min && value <= max ? value : fallback;
}

export const PORT = Number(process.env.PORT || 21246);
export const NETWORK_BUILD = "network-guard-20260724-01";
export const NETWORK_PROTOCOL_VERSION = 2;
export const SNAPSHOT_INTERVAL = 1 / SNAPSHOT_RATE;
export const ROOM_CAPACITY = 2;
export const MAX_CATCHUP_STEPS = 6;
export const LOOP_IDLE_MS = 2;
export const PVP_COUNTDOWN_MS = 3000;
export const FINISHED_ROOM_CLOSE_DELAY_MS = 10_000;
export const MAX_SNAPSHOT_BUFFERED_BYTES = 128 * 1024;
export const SNAPSHOT_KEYFRAME_INTERVAL = SNAPSHOT_RATE * 5;
export const MAX_DELTA_TO_FULL_RATIO = 0.8;
export const PLAYER_STREAM_DIVISORS = [1, 2, 3];
export const SPECTATOR_STREAM_DIVISORS = [2, 3, 5];
export const CONGESTION_BUFFERED_BYTES = 24 * 1024;
export const SEVERE_CONGESTION_BUFFERED_BYTES = 96 * 1024;
export const CONGESTION_INFLIGHT_SNAPSHOTS = 12;
export const SEVERE_CONGESTION_INFLIGHT_SNAPSHOTS = 30;
export const CONGESTION_ACK_AGE_MS = 1200;
export const SEVERE_CONGESTION_ACK_AGE_MS = 3000;
export const STREAM_RECOVERY_STABLE_MS = 4000;
export const LOBBY_BROADCAST_DEBOUNCE_MS = 30;
export const MAX_PAYLOAD_BYTES = envInteger("MAX_PAYLOAD_BYTES", 16 * 1024, 1024, 64 * 1024);
export const MAX_CONNECTIONS = envInteger("MAX_CONNECTIONS", 256, 8, 4096);
export const MAX_ROOMS = envInteger("MAX_ROOMS", 64, 4, 1024);
export const MAX_ACTIVE_ROOMS = envInteger("MAX_ACTIVE_ROOMS", 16, 2, 512);
export const MAX_SPECTATORS_PER_ROOM = envInteger("MAX_SPECTATORS_PER_ROOM", 24, 1, 256);
export const MAX_STREAM_CAPACITY_UNITS = envInteger("MAX_STREAM_CAPACITY_UNITS", 72, 4, 2048);
export const HEARTBEAT_INTERVAL_MS = envInteger("HEARTBEAT_INTERVAL_MS", 30_000, 100, 120_000);
export const NETWORK_METRICS_INTERVAL_MS = envInteger("NETWORK_METRICS_INTERVAL_MS", 60_000, 1000, 600_000);
export const STATS_DATA_DIR = process.env.STATS_DATA_DIR || resolve(process.cwd(), "data/statistics");
export const STATS_HASH_SALT = process.env.STATS_HASH_SALT || "";
