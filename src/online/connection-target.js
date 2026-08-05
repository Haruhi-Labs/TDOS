const DEFAULT_REMOTE_WS_PORT = 21246;

export function isLocalHostname(hostname) {
  if (!hostname) {
    return false;
  }
  const host = String(hostname).toLowerCase();
  if (host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "0.0.0.0") {
    return true;
  }
  if (host.startsWith("10.") || host.startsWith("192.168.") || host.endsWith(".local")) {
    return true;
  }
  return /^172\.(1[6-9]|2\d|3[0-1])\./.test(host);
}

export function buildServerUrlCandidates({
  locationObject = window.location,
  baseUrl = import.meta.env.BASE_URL,
  remotePort = DEFAULT_REMOTE_WS_PORT,
} = {}) {
  const params = new URLSearchParams(locationObject.search || "");
  const forced = String(params.get("ws") || "").trim();
  if (forced) {
    return [forced];
  }

  const pageProtocol = locationObject.protocol === "https:" ? "wss" : "ws";
  const pageHost = locationObject.host || "";
  const pageHostname = locationObject.hostname || "";
  const localHost = isLocalHostname(pageHostname);
  const directProtocol = localHost ? "ws" : pageProtocol;
  const list = [];

  if (pageHost) {
    // 同源入口跟随部署 base；本地或反向代理不可用时再尝试直连端口。
    list.push(`${pageProtocol}://${pageHost}${baseUrl}ws/`);
  }
  if (pageHostname) {
    list.push(`${directProtocol}://${pageHostname}:${remotePort}/`);
  } else {
    list.push(`ws://127.0.0.1:${remotePort}/`);
  }
  if (localHost) {
    if (pageHostname !== "127.0.0.1") list.push(`ws://127.0.0.1:${remotePort}/`);
    if (pageHostname !== "localhost") list.push(`ws://localhost:${remotePort}/`);
  }

  return list.filter((url, index) => url && list.indexOf(url) === index);
}

export function defaultServerUrl(options) {
  return buildServerUrlCandidates(options)[0] || "";
}
