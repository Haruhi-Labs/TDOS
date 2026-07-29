import { access, readFile } from "node:fs/promises";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const source = await readFile(new URL("../src/online.js", import.meta.url), "utf8");
const menuSource = await readFile(new URL("../src/menu.js", import.meta.url), "utf8");
const mainSource = await readFile(new URL("../src/main.js", import.meta.url), "utf8");
const i18nSource = await readFile(new URL("../src/i18n.js", import.meta.url), "utf8");
const rulesPageUrl = new URL("../src/stellar3v3-rules.js", import.meta.url);

for (const id of ["create3v3PublicBtn", "create3v3PrivateBtn", "stellarRoomSeats", "startMatchBtn"]) {
  assert(source.includes(`id=\"${id}\"`), `online lobby must render #${id}`);
}
assert(source.includes('id="onlineActionStatus"'), "online lobby must render a visible action-status region");
assert(source.includes("function showOnlineActionStatus"), "online client must be able to report lobby actions visibly");
assert(
  source.includes("const errorMessage = translateServerText(") && source.includes('showOnlineActionStatus(errorMessage, "error")'),
  "server room-creation errors must be translated and surfaced in the lobby",
);
assert(source.includes('mode: "stellar3v3"'), "client must create stellar3v3 rooms");
assert(
  source.includes('list.push(`${pageProtocol}://${pageHost}${import.meta.env.BASE_URL}ws`);'),
  "same-origin lobby WebSocket URL must use the server's /ws route without a trailing slash",
);
assert(source.includes('type: "configure_slot"'), "client must configure bot seats");
assert(source.includes('type: "choose_seat"'), "client must let players choose seats");
assert(source.includes('type: "start_match"'), "client must let hosts start valid rooms");
assert(source.includes("function isStellar3v3Room"), "client must identify stellar3v3 room state");
assert(source.includes("data-bot-loadout"), "client must let the host choose a bot loadout preset");
assert(source.includes("room.joinable"), "client must respect server-advertised room joinability");
assert(menuSource.includes('href: "/stellar3v3"'), "main menu must link to the dedicated 3v3 lobby");
assert(mainSource.includes('"/stellar3v3"'), "router must register the dedicated 3v3 lobby route");
assert(source.includes("export function mountStellar3v3"), "online module must export a dedicated 3v3 lobby mount");
assert(source.includes('data-add-bot'), "host must get a clear add-bot action for an open 3v3 seat");
assert(source.includes('data-remove-bot'), "host must get a clear remove-bot action for a bot 3v3 seat");
assert(source.includes("modeScope"), "3v3 client joins must declare their lobby mode scope");
assert(source.includes('return t("星域争夺 3v3")'), "3v3 rooms must use their dedicated mode label");
assert(source.includes('mode: room.mode'), "3v3 reconnect tickets must retain the room mode");
assert(source.includes('ticket.modeScope !== lobbyModeScope()'), "reconnect attempts must stay inside the current lobby scope");
assert(source.includes('const reconnectableStatus = room?.status === "countdown" || room?.status === "running";'), "only resumable 3v3 states may persist reconnect tickets");
assert(source.includes("function describeLoadout"), "3v3 loadout text must use a shared localized formatter");
assert(source.includes("const MAP_PAN_START_DISTANCE_PX = 6"), "3v3 battles must preserve Prototype's mouse-pan threshold");
assert(source.includes("function syncStellar3v3Camera"), "3v3 snapshots must synchronize the battle camera to the territory map");
assert(source.includes("camera.setWorldSize(worldSize, worldSize)"), "3v3 camera must use the territory world dimensions");
assert(source.includes("const stellarWorldSize = Number(state.territory?.map?.worldSize?.width || state.territory?.map?.worldSize || state.world?.size)"), "3v3 battle rendering must prefer the territory map world size");
assert(source.includes("worldSize: { width: stellarWorldSize, height: stellarWorldSize }"), "3v3 battle rendering must pass the territory world dimensions to the shared renderer");
assert(source.includes("renderTerritoryMinimapOverlay"), "3v3 battle rendering must include the territory minimap overlay");
assert(source.includes("frame.minimapLayerAfterBackground"), "3v3 battle rendering must install the territory minimap in the shared minimap layer");
assert(source.includes('from "../shared/gameplay/territory-navigation.js"'), "3v3 client route prediction must use the shared territory planner");
assert(source.includes("planTerritoryRoute({"), "3v3 local route prediction must plan around territory obstacles");
assert(source.includes("plannedRoute.waypoints[0]"), "3v3 local route prediction must target the planned first waypoint");
assert(source.includes("function activeMapBounds"), "3v3 client must resolve the active map bounds for local predictions");
assert(source.includes("activeMapBounds().width"), "3v3 local route prediction must clamp X coordinates against the active map width");
assert(source.includes("activeMapBounds().height"), "3v3 local route prediction must clamp Y coordinates against the active map height");
assert(source.includes('href="/stellar3v3/rules"'), "3v3 lobby must link to the dedicated rules page");
assert(i18nSource.includes('"3v3 规则说明": "3v3 ルール"'), "3v3 rules entry must have a Japanese translation");
assert(i18nSource.includes('"3v3 规则说明": "3v3 Rules"'), "3v3 rules entry must have an English translation");
assert(mainSource.includes('"/stellar3v3/rules"'), "router must register the 3v3 rules page");
try {
  await access(rulesPageUrl);
} catch {
  throw new Error("3v3 rules page module must exist");
}
const rulesSource = await readFile(rulesPageUrl, "utf8");
assert(rulesSource.includes("STELLAR_TERRITORY_DEFAULT_PARAMETERS"), "3v3 rules page must read shared default parameters");
assert(rulesSource.includes("TERRAIN_MOVEMENT_MULTIPLIERS"), "3v3 rules page must read shared terrain modifiers");
assert(source.includes("camera.panByScreenDelta"), "3v3 empty-space drags must pan the camera");
for (const label of ["AI 指挥单元", "断线接管中", "开放", "关闭", "未配置", "已准备", "未准备", "随机", "随机阵容", "A 阵营", "B 阵营"]) {
  assert(source.includes(`t("${label}")`), `3v3 seat UI label must use i18n: ${label}`);
  assert(i18nSource.includes(`"${label}":`), `3v3 seat UI label must have a locale mapping: ${label}`);
}

console.log("3v3 client contract verification passed");
