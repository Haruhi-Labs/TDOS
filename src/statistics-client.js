import { RULESET_VERSION } from "../shared/protocol/ruleset-version.js";
import { getLocale } from "./i18n.js";
import { buildServerUrlCandidates } from "./online/connection-target.js";
import { getProfile } from "./profile.js";

const REQUEST_TIMEOUT_MS = 6000;

export function statisticsProfile() {
  const profile = getProfile();
  return {
    clientId: profile.clientId,
    nickname: profile.nickname,
    faction: profile.faction,
    locale: getLocale(),
  };
}

export function statisticsEnvironment(renderer = "unknown") {
  const width = Math.max(0, Number(window.innerWidth) || 0);
  const formFactor = width <= 720 ? "compact" : width <= 1180 ? "standard" : "wide";
  const pixelRatio = Math.max(1, Number(window.devicePixelRatio) || 1);
  const pixelRatioBucket = pixelRatio < 1.5 ? "1x" : pixelRatio < 2.5 ? "2x" : "3x+";
  return {
    formFactor,
    renderer: ["webgl2", "webgl1", "canvas2d"].includes(renderer) ? renderer : "unknown",
    pixelRatioBucket,
    timezoneOffsetMinutes: new Date().getTimezoneOffset(),
  };
}

function performStatisticsRequest(message, expectedType) {
  const candidates = buildServerUrlCandidates();
  return new Promise((resolve, reject) => {
    let settled = false;
    let attempt = 0;
    let socket = null;
    const timer = window.setTimeout(() => finish(null, new Error("统计服务响应超时")), REQUEST_TIMEOUT_MS);

    function cleanup() {
      window.clearTimeout(timer);
      if (socket) {
        socket.onopen = null;
        socket.onmessage = null;
        socket.onerror = null;
        socket.onclose = null;
        try { socket.close(1000, "统计请求完成"); } catch (_error) { /* 已关闭 */ }
      }
    }

    function finish(value, error = null) {
      if (settled) return;
      settled = true;
      cleanup();
      if (error) reject(error);
      else resolve(value);
    }

    function connectNext() {
      if (settled) return;
      if (attempt >= candidates.length) {
        finish(null, new Error("无法连接统计服务"));
        return;
      }
      socket = new WebSocket(candidates[attempt]);
      attempt += 1;
      let opened = false;
      socket.onopen = () => {
        opened = true;
        socket.send(JSON.stringify({
          type: "protocol_hello",
          protocolVersion: 2,
          rulesetVersion: RULESET_VERSION,
        }));
        socket.send(JSON.stringify({ type: "set_statistics_profile", profile: statisticsProfile() }));
        socket.send(JSON.stringify(message));
      };
      socket.onmessage = (event) => {
        let payload = null;
        try { payload = JSON.parse(String(event.data)); } catch (_error) { return; }
        if (payload?.type === expectedType) finish(payload);
      };
      socket.onerror = () => {
        if (!opened) {
          try { socket.close(); } catch (_error) { /* 忽略 */ }
        }
      };
      socket.onclose = () => {
        if (!settled) connectNext();
      };
    }

    connectNext();
  });
}

export async function requestWinrateStatistics() {
  const response = await performStatisticsRequest(
    { type: "get_winrate_stats" },
    "winrate_stats",
  );
  return response.stats;
}

export async function reportSoloMatchStatistics({ eventId, startedAt, difficulty, summary, renderer }) {
  const response = await performStatisticsRequest({
    type: "report_solo_match",
    eventId,
    startedAt,
    difficulty,
    rulesetVersion: RULESET_VERSION,
    profile: statisticsProfile(),
    environment: statisticsEnvironment(renderer),
    summary,
  }, "statistics_report_result");
  return Boolean(response.accepted || response.reason === "duplicate");
}
