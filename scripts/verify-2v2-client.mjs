import { readFile } from "node:fs/promises";
import { spawn } from "node:child_process";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function functionBlock(source, name) {
  const marker = `function ${name}`;
  const start = source.indexOf(marker);
  assert(start >= 0, `Missing function ${name}`);
  const bodyStart = source.indexOf("{", start);
  assert(bodyStart >= 0, `Missing function body for ${name}`);
  let depth = 0;
  for (let index = bodyStart; index < source.length; index += 1) {
    const char = source[index];
    if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return source.slice(start, index + 1);
      }
    }
  }
  throw new Error(`Unterminated function body for ${name}`);
}

async function nodeCheck(file) {
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--check", file], {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${file} syntax check failed\n${stderr}`));
      }
    });
  });
}

const [onlineSource, renderSource] = await Promise.all([
  readFile("src/online.js", "utf8"),
  readFile("src/battle/render.js", "utf8"),
]);

await Promise.all([
  nodeCheck("src/online.js"),
  nodeCheck("src/battle/render.js"),
]);

assert(onlineSource.includes('id="create2v2Btn"'), "online UI should expose a create 2v2 room button");
assert(onlineSource.includes('id="readyRoomBtn"'), "online UI should expose a 2v2 ready toggle button");
assert(onlineSource.includes('mode: "pvp2v2"'), "client should be able to create pvp2v2 rooms");
assert(onlineSource.includes('type: "set_ready"'), "client should send set_ready for pvp2v2 rooms");
assert(onlineSource.includes("function isTwoVsTwoState("), "client should detect 2v2 fleet snapshots");
assert(onlineSource.includes("function fleetEntriesForAlliance("), "client should group visible fleets by alliance");
assert(onlineSource.includes("function interpolateFleetMap("), "client interpolation should handle state.fleets snapshots");
assert(onlineSource.includes("function extrapolateFleetMap("), "client extrapolation should handle state.fleets snapshots");
assert(onlineSource.includes("friendlyTeams"), "client render frame should pass friendly fleets to the renderer");
assert(onlineSource.includes("enemyTeams"), "client render frame should pass enemy fleets to the renderer");
assert(onlineSource.includes("teamCommButtons"), "online UI should cache team communication buttons");
assert(onlineSource.includes("mobileTeamCommButtons"), "online UI should cache mobile team communication buttons");
assert(onlineSource.includes("teamCommFeed"), "online UI should expose a team communication event feed");
assert(onlineSource.includes("mobileTeamCommFeed"), "online UI should expose a mobile team communication event feed");
assert(onlineSource.includes("function sendTeamComm("), "client should send team_comm messages");
assert(onlineSource.includes('type: "team_comm"'), "client should use the team_comm protocol message");
assert(onlineSource.includes('type === "team_comm_event"'), "client should handle team communication events");
assert(onlineSource.includes("teamComms:"), "render frame should pass active team communication markers");
assert(onlineSource.includes("ONLINE_RECONNECT_STORAGE_KEY"), "client should keep 2v2 reconnect metadata in session storage");
assert(onlineSource.includes("function persistReconnectTicket("), "client should persist reconnect tickets from room_state");
assert(onlineSource.includes("function tryResumePlayer("), "client should attempt resume after reconnecting to the server");
assert(onlineSource.includes('type: "resume_player"'), "client should use the resume_player protocol message");
assert(onlineSource.includes("clearReconnectTicket"), "client should clear reconnect tickets on intentional leave and match close");
assert(onlineSource.includes("fleetDefeated"), "client should track defeated-fleet observer state from viewer snapshots");
assert(onlineSource.includes("canControlFleet"), "client should honor server-provided fleet control state");
assert(onlineSource.includes("function defeatedObservationTeam("), "client should keep defeated players in allied observation mode");

const setControlsBody = functionBlock(onlineSource, "setBattleControlsEnabled");
assert(
  !setControlsBody.includes("querySelectorAll") && !setControlsBody.includes("element.disabled"),
  "setBattleControlsEnabled must not blindly rewrite every battle control disabled state",
);

assert(onlineSource.includes("function routeOverrideKey("), "client route override state should use a namespaced ship key");
for (const token of [
  "setRouteOverride(routeOverrideKey",
  "app.routeOverrides.get(routeOverrideKey",
  "app.routeOverrides.delete(routeOverrideKey",
]) {
  assert(onlineSource.includes(token), `route override lifecycle should use namespaced keys: ${token}`);
}
assert(
  !functionBlock(onlineSource, "getRouteForShip").includes("app.routeOverrides.get(ship.key)"),
  "route rendering must not read local overrides by bare ship.key",
);

const resultBody = functionBlock(onlineSource, "showMatchResultOverlay");
assert(
  resultBody.includes("winnerAllianceId") && resultBody.includes("app.allianceId"),
  "2v2 result overlay should compare winnerAllianceId with the local alliance",
);
assert(!resultBody.includes("winnerSeat === app.seat"), "2v2 result overlay must not compare alliance winners to player seats");
assert(
  !resultBody.includes('seat === "A"') && !resultBody.includes('seat === "B"'),
  "2v2 result roster should not be hard-coded to only legacy A/B seats",
);

assert(
  renderSource.includes("frame.friendlyTeams") && renderSource.includes("frame.enemyTeams"),
  "battle renderer should accept multi-fleet frame teams",
);
assert(renderSource.includes("drawTeamCommMarker"), "battle renderer should draw team communication markers");

console.log("2v2 client integration checks passed");
