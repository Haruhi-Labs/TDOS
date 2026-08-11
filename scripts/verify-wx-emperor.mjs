import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";

import {
  CHARACTER_DEFS,
  CHARACTER_ORDER,
  MatchSimulation,
  randomAiLoadout,
} from "../shared/game-core.js";
import {
  WX_IMPERIAL_SKILLS,
  normalizeWxAnchorSnapshot,
  serializeWxAnchor,
  wxComboFlashesForViewer,
} from "../shared/game/wx-emperor.js";
import { interpolateBattleState } from "../src/battle/state-interpolation.js";
import { wxAnchorSkillAvailability } from "../src/battle/hud.js";

const DT = 1 / 30;

function createSimulation(loadouts, options = {}) {
  return new MatchSimulation({
    mode: options.mode || "pvp",
    worldSize: 1440,
    aiSeats: options.aiSeats || [],
    teamLoadouts: loadouts,
  });
}

function runSteps(simulation, seconds) {
  for (let index = 0; index < Math.ceil(seconds / DT); index += 1) {
    simulation.update(DT);
  }
}

function characterContract() {
  assert.ok(CHARACTER_ORDER.includes("wx_emperor"));
  const definition = CHARACTER_DEFS.wx_emperor;
  assert.equal(definition.name, "超银河帝国·王牌防御塔一世·wx陛下");
  assert.equal(definition.flagshipSkill.id, "imperial_anchor");
  assert.equal(definition.subSkill.id, "imperial_anchor");
  assert.equal(definition.flagshipSkill.cost, 20);
  const observedMains = new Set();
  for (let index = 0; index < 160; index += 1) {
    const loadout = randomAiLoadout();
    assert.equal(new Set(Object.values(loadout)).size, 3);
    observedMains.add(loadout.main);
  }
  assert.ok(observedMains.has("wx_emperor"), "wx must remain eligible for AI flagship slots");
}

function anchorLifecycleContract() {
  const simulation = createSimulation({
    A: { main: "wx_emperor", sub1: "koizumi", sub2: "yuki" },
    B: { main: "kyon", sub1: "haruhi", sub2: "tsuruya" },
  });
  const team = simulation.teamA;
  const main = team.ships.main;
  const ally = team.ships.sub1;
  team.pickImperialSkill = () => null;
  main.energy = 10;
  ally.energy = 30;
  team.ships.sub2.energy = 0;
  main.route = { marker: true };
  main.speed = 18;

  assert.equal(team.castFlagshipSkill(), true);
  assert.equal(team.wxAnchor.active, true);
  assert.equal(team.wxAnchor.scope, "fleet");
  assert.equal(Math.round(team.fleetEnergyForShip("main").current), 20);
  assert.equal(main.speed, 0);
  assert.equal(main.route, null);
  assert.equal(main.damageTakenMultiplier(), 0.769);
  assert.equal(ally.damageTakenMultiplier(), 0.916);
  assert.equal(main.effectiveRange(), CHARACTER_DEFS.wx_emperor.stats.range * 1.105);
  assert.equal(team.serialize().wxAnchor.duelZone.radius, 160);

  runSteps(simulation, 1);
  assert.ok(team.wxAnchor.remaining < 10, "anchor upkeep must drain the anchor ship's energy");
  main.energy = 0;
  runSteps(simulation, DT);
  assert.equal(team.wxAnchor.active, false);
  assert.ok(team.wxAnchor.overheatRemaining > 3.9);
  assert.equal(team.castFlagshipSkill(), false, "overheat must block re-entry");
  runSteps(simulation, 4.1);
  assert.equal(team.wxAnchor.overheatRemaining, 0);

  const overheated = createSimulation({
    A: { main: "wx_emperor", sub1: "koizumi", sub2: "yuki" },
    B: { main: "kyon", sub1: "haruhi", sub2: "tsuruya" },
  });
  overheated.teamA.pickImperialSkill = () => null;
  const hotShip = overheated.teamA.ships.main;
  hotShip.energy = 40;
  hotShip.throttle = 0;
  overheated.teamA.ships.sub1.energy = 0;
  overheated.teamA.ships.sub2.energy = 0;
  overheated.teamA.castFlagshipSkill();
  overheated.teamA.exitWxAnchor("manual");
  const hotBefore = hotShip.energy;
  runSteps(overheated, 1);
  const hotRegen = hotShip.energy - hotBefore;

  const normal = createSimulation({
    A: { main: "wx_emperor", sub1: "koizumi", sub2: "yuki" },
    B: { main: "kyon", sub1: "haruhi", sub2: "tsuruya" },
  });
  const normalShip = normal.teamA.ships.main;
  normalShip.energy = hotBefore;
  normalShip.throttle = 0;
  normal.teamA.ships.sub1.energy = 0;
  normal.teamA.ships.sub2.energy = 0;
  const normalBefore = normalShip.energy;
  runSteps(normal, 1);
  const normalRegen = normalShip.energy - normalBefore;
  assert.ok(Math.abs(hotRegen / normalRegen - 0.5) < 0.02, "overheat must halve wx energy regeneration");
}

function subAnchorAndDuelContract() {
  const simulation = createSimulation({
    A: { main: "haruhi", sub1: "wx_emperor", sub2: "yuki" },
    B: { main: "kyon", sub1: "koizumi", sub2: "tsuruya" },
  });
  const team = simulation.teamA;
  team.pickImperialSkill = () => null;
  assert.equal(team.split(1), true);
  const wx = team.ships.sub1;
  const ally = team.ships.main;
  const enemy = simulation.teamB.ships.main;
  Object.assign(wx, { x: 660, y: 720, energy: 100, speed: 12, route: { marker: true } });
  Object.assign(enemy, { x: 700, y: 720, speed: 0, route: null });
  ally.energy = 0;

  assert.equal(team.castSubSkill("sub1"), true);
  assert.equal(team.wxAnchor.scope, "self");
  assert.equal(ally.damageTakenMultiplier(), 1, "sub anchor must not grant a fleet aura");
  assert.equal(wx.inWxDuelZone(enemy), true);
  assert.ok(wx.effectiveDamageAgainst(enemy) > wx.effectiveDamage());
  assert.ok(enemy.effectiveDamageAgainst(wx) > enemy.effectiveDamage());

  const other = createSimulation({
    A: { main: "haruhi", sub1: "wx_emperor", sub2: "yuki" },
    B: { main: "wx_emperor", sub1: "koizumi", sub2: "tsuruya" },
  });
  other.teamA.pickImperialSkill = () => null;
  other.teamB.pickImperialSkill = () => null;
  other.teamA.split(1);
  Object.assign(other.teamA.ships.sub1, { x: 240, y: 240, energy: 100 });
  Object.assign(other.teamB.ships.main, { x: 1080, y: 1080, energy: 100 });
  other.teamA.castSubSkill("sub1");
  other.teamB.castFlagshipSkill();
  assert.equal(
    other.teamA.ships.sub1.effectiveDamageAgainst(other.teamB.ships.main),
    other.teamA.ships.sub1.effectiveDamage(),
    "separate duel zones must not leak bonuses across the map",
  );
}

function challengePrivacyContract() {
  const simulation = createSimulation({
    A: { main: "haruhi", sub1: "koizumi", sub2: "yuki" },
    B: { main: "wx_emperor", sub1: "tsuruya", sub2: "future1096" },
  });
  simulation.teamB.pickImperialSkill = () => null;
  const wx = simulation.teamB.ships.main;
  Object.assign(wx, { x: 1180, y: 120, energy: 120 });
  assert.equal(simulation.teamB.castFlagshipSkill(), true);
  const publicAnchor = serializeWxAnchor(simulation.teamB, { publicOnly: true });
  assert.deepEqual(Object.keys(publicAnchor), ["challengePulse"]);
  assert.deepEqual(publicAnchor.challengePulse, { x: 1180, y: 120, radius: 160, remaining: 3 });
  assert.equal(publicAnchor.active, undefined);
  assert.equal(publicAnchor.scope, undefined);
  assert.equal(publicAnchor.shipKey, undefined);

  const flashes = [
    { id: "guard", teamSeat: "A", visibleToEnemy: false },
    { id: "campaign", teamSeat: "B", visibleToEnemy: true },
  ];
  assert.deepEqual(wxComboFlashesForViewer(flashes, "A").map((flash) => flash.id), ["guard", "campaign"]);
  assert.deepEqual(wxComboFlashesForViewer(flashes, "B").map((flash) => flash.id), ["campaign"]);
  assert.deepEqual(wxComboFlashesForViewer(flashes).map((flash) => flash.id), ["campaign"]);
}

function imperialBuffContracts() {
  const guardSimulation = createSimulation({
    A: { main: "wx_emperor", sub1: "koizumi", sub2: "yuki" },
    B: { main: "kyon", sub1: "haruhi", sub2: "tsuruya" },
  });
  const guardTeam = guardSimulation.teamA;
  guardTeam.ships.main.energy = 120;
  guardTeam.ships.sub1.energy = 0;
  guardTeam.ships.sub2.energy = 0;
  guardTeam.pickImperialSkill = () => WX_IMPERIAL_SKILLS[0];
  assert.equal(guardTeam.castFlagshipSkill(), true);
  assert.equal(guardTeam.hasActiveImperialGuard(), true);
  assert.equal(guardTeam.hasActiveImperialMight(), false);
  assert.equal(guardTeam.ships.sub1.damageTakenMultiplier(), 0.916 * 0.79);
  runSteps(guardSimulation, DT);
  guardTeam.clearActiveSkillBuffs();
  assert.equal(guardTeam.hasActiveImperialGuard(), false, "imperial guard must be purifiable");

  const mightSimulation = createSimulation({
    A: { main: "wx_emperor", sub1: "koizumi", sub2: "yuki" },
    B: { main: "kyon", sub1: "haruhi", sub2: "tsuruya" },
  });
  const mightTeam = mightSimulation.teamA;
  mightTeam.ships.main.energy = 120;
  mightTeam.ships.sub1.energy = 0;
  mightTeam.ships.sub2.energy = 0;
  const baseDamage = mightTeam.ships.sub1.effectiveDamage();
  mightTeam.pickImperialSkill = () => WX_IMPERIAL_SKILLS[2];
  assert.equal(mightTeam.castFlagshipSkill(), true);
  assert.equal(mightTeam.hasActiveImperialMight(), true);
  assert.equal(mightTeam.ships.sub1.effectiveDamage(), baseDamage * 1.2625);
}

function imperialCampaignContract() {
  const simulation = createSimulation({
    A: { main: "wx_emperor", sub1: "koizumi", sub2: "yuki" },
    B: { main: "kyon", sub1: "haruhi", sub2: "tsuruya" },
  });
  const team = simulation.teamA;
  const wx = team.ships.main;
  const target = simulation.teamB.ships.main;
  wx.energy = 120;
  team.ships.sub1.energy = 0;
  team.ships.sub2.energy = 0;
  Object.assign(target, { x: wx.x + 600, y: wx.y, speed: 0, route: null });
  target.command.x = target.x;
  target.command.y = target.y;
  simulation.teamB.ships.sub1.alive = false;
  simulation.teamB.ships.sub2.alive = false;
  team.visibleEnemyIds.add(target.id);
  const startingHp = target.hp;
  team.pickImperialSkill = () => WX_IMPERIAL_SKILLS[1];

  assert.equal(team.castFlagshipSkill(), true);
  const bolt = simulation.projectiles.find((projectile) => projectile.visualKind === "imperial_bolt");
  assert.ok(bolt, "imperial campaign must emit the fixed skill projectile");
  assert.equal(bolt.damage, target.maxHp * 0.189);
  assert.equal(bolt.skillBolt, true);
  assert.ok(simulation.comboFlashes.some((flash) => flash.skillId === "imperial_campaign"));
  const serialized = simulation.serializeState();
  assert.equal(serialized.projectiles[0].visualKind, "imperial_bolt");
  assert.ok(Array.isArray(serialized.comboFlashes));
  runSteps(simulation, 2.5);
  assert.equal(target.hp, startingHp - target.maxHp * 0.189);

  const hiddenSimulation = createSimulation({
    A: { main: "wx_emperor", sub1: "koizumi", sub2: "yuki" },
    B: { main: "kyon", sub1: "haruhi", sub2: "tsuruya" },
  });
  const hiddenTeam = hiddenSimulation.teamA;
  hiddenTeam.ships.main.energy = 120;
  hiddenTeam.ships.sub1.energy = 0;
  hiddenTeam.ships.sub2.energy = 0;
  hiddenTeam.visibleEnemyIds.clear();
  hiddenTeam.pickImperialSkill = () => WX_IMPERIAL_SKILLS[1];
  assert.equal(hiddenTeam.castFlagshipSkill(), true, "anchor entry must survive a campaign fizzle");
  assert.equal(hiddenSimulation.projectiles.length, 0, "campaign must not target hidden enemies");
  assert.equal(hiddenTeam.hasActiveImperialGuard(), false);
  assert.equal(hiddenTeam.hasActiveImperialMight(), false);
}

function anchorImmunityContract() {
  const simulation = createSimulation({
    A: { main: "wx_emperor", sub1: "koizumi", sub2: "yuki" },
    B: { main: "haruhi", sub1: "kyon", sub2: "tsuruya" },
  });
  const team = simulation.teamA;
  team.pickImperialSkill = () => null;
  const wx = team.ships.main;
  wx.energy = 100;
  team.ships.sub1.energy = 0;
  team.ships.sub2.energy = 0;
  team.castFlagshipSkill();
  const energyBeforeBrake = wx.energy;
  assert.equal(team.emergencyBrake(wx), false, "emergency brake must reject an anchored wx ship");
  assert.equal(wx.energy, energyBeforeBrake, "rejected emergency brake must not spend anchor energy");
  const before = { x: wx.x, y: wx.y };
  assert.equal(team.blinkShip(wx, wx.x + 100, wx.y), false);

  const enemy = simulation.teamB.ships.main;
  Object.assign(enemy, { x: wx.x + 1, y: wx.y, route: null });
  simulation.resolveShipCollisions();
  assert.deepEqual({ x: wx.x, y: wx.y }, before, "collision resolution must not move anchored wx");

  simulation.teamB.haruhiFlagship.supporters.add("otherworlder");
  simulation.teamB.haruhiFlagship.otherworlderReadyAt = simulation.elapsed;
  Object.assign(enemy, {
    x: wx.x - enemy.radius - wx.radius + 1,
    y: wx.y,
    angle: 0,
    speed: enemy.effectiveSpeed(),
    throttle: 1,
    command: { x: wx.x + 500, y: wx.y },
  });
  const hpBeforeOtherworlder = wx.hp;
  simulation.resolveHaruhiOtherworlderContacts();
  assert.ok(wx.hp < hpBeforeOtherworlder, "anchoring must not suppress Otherworlder impact damage");
  assert.equal(wx.forcedKnockback, null, "anchored wx must reject Otherworlder displacement");
  assert.equal(
    simulation.teamB.serialize().haruhiFlagship.otherworlderReady,
    false,
    "successful Otherworlder impact must still consume its cooldown",
  );
}

function compatibilityContract() {
  assert.deepEqual(normalizeWxAnchorSnapshot(undefined), {
    active: false,
    scope: "self",
    remaining: 0,
    overheatRemaining: 0,
    challengePulse: null,
    duelZone: null,
  });
}

function koizumiOrbAnchorResistanceContract() {
  const simulation = createSimulation({
    A: { main: "wx_emperor", sub1: "koizumi", sub2: "yuki" },
    B: { main: "kyon", sub1: "koizumi", sub2: "yuki" },
  });
  const wxTeam = simulation.teamA;
  const attackerTeam = simulation.teamB;
  wxTeam.pickImperialSkill = () => null;
  wxTeam.ships.main.energy = 120;
  wxTeam.ships.sub1.energy = 0;
  wxTeam.ships.sub2.energy = 0;
  assert.equal(wxTeam.castFlagshipSkill(), true);

  const wx = wxTeam.ships.main;
  const ally = wxTeam.ships.sub1;
  const allyTwo = wxTeam.ships.sub2;
  Object.assign(wx, { x: 790, y: 720, forcedKnockback: null });
  Object.assign(ally, { x: 790, y: 980, forcedKnockback: null });
  Object.assign(allyTwo, { x: 900, y: 980, forcedKnockback: null });

  attackerTeam.split(1);
  const attacker = attackerTeam.ships.sub1;
  attacker.energy = attacker.maxEnergy;
  assert.equal(attackerTeam.castSubSkill("sub1"), true);
  attacker.koizumiOrb.hitAt.clear();
  attacker.koizumiOrb.previousX = 700;
  attacker.koizumiOrb.previousY = 720;
  attacker.x = 810;
  attacker.y = 720;
  simulation.resolveKoizumiOrbContacts();

  assert.equal(wx.forcedKnockback, null, "anchored wx must reject Koizumi orb displacement");
  assert.ok(ally.forcedKnockback, "the flagship anchor aura must leave allies knockback-eligible");
  const allyDistance = Math.hypot(
    ally.forcedKnockback.toX - ally.forcedKnockback.fromX,
    ally.forcedKnockback.toY - ally.forcedKnockback.fromY,
  );
  assert.ok(
    allyDistance > attacker.effectiveVision() * 0.78
      && allyDistance < attacker.effectiveVision() * 0.88,
    "the flagship anchor aura must reduce Koizumi orb knockback distance",
  );
}

function interpolationContract() {
  const simulation = createSimulation({
    A: { main: "wx_emperor", sub1: "koizumi", sub2: "yuki" },
    B: { main: "kyon", sub1: "haruhi", sub2: "tsuruya" },
  });
  simulation.teamA.ships.main.energy = 120;
  simulation.teamA.ships.sub1.energy = 0;
  simulation.teamA.ships.sub2.energy = 0;
  simulation.teamA.pickImperialSkill = () => WX_IMPERIAL_SKILLS[0];
  simulation.teamA.castFlagshipSkill();
  const previous = simulation.serializeState();
  runSteps(simulation, 0.1);
  const current = simulation.serializeState();
  current.teams.A.wxAnchor.duelZone.x += 20;
  const display = interpolateBattleState(previous, current, 0.5, { spanSeconds: 0.1 });
  assert.equal(display.comboFlashes.length, 1);
  assert.ok(display.comboFlashes[0].life < previous.comboFlashes[0].life);
  assert.ok(display.comboFlashes[0].life > current.comboFlashes[0].life);
  assert.equal(
    display.teams.A.wxAnchor.duelZone.x,
    (previous.teams.A.wxAnchor.duelZone.x + current.teams.A.wxAnchor.duelZone.x) / 2,
  );
}

function hudAvailabilityContract() {
  const meta = CHARACTER_DEFS.wx_emperor.flagshipSkill;
  const ship = { characterId: "wx_emperor" };
  const active = wxAnchorSkillAvailability({
    own: { wxAnchor: { active: true, scope: "fleet", overheatRemaining: 0 } },
    ship,
    meta,
    scope: "fleet",
    energy: 1,
  });
  assert.equal(active.active, true);
  assert.equal(active.entryBlocked, false, "an active anchor must remain releasable below entry cost");

  const overheated = wxAnchorSkillAvailability({
    own: { wxAnchor: { active: false, scope: "self", overheatRemaining: 3 } },
    ship,
    meta,
    scope: "fleet",
    energy: 150,
  });
  assert.equal(overheated.active, false);
  assert.equal(overheated.entryBlocked, true, "overheat must disable anchor re-entry even at full energy");
}

function aiAnchorContract() {
  const simulation = createSimulation({
    A: { main: "kyon", sub1: "haruhi", sub2: "yuki" },
    B: { main: "wx_emperor", sub1: "tsuruya", sub2: "future1096" },
  }, { mode: "ai", aiSeats: ["B"] });
  const enemy = simulation.teamA.ships.main;
  const wx = simulation.teamB.ships.main;
  Object.assign(enemy, { x: 820, y: 720, speed: 0, route: null });
  Object.assign(wx, { x: 360, y: 720, speed: 0, route: null, energy: 120 });
  simulation.teamB.visibleEnemyIds.add(enemy.id);
  const bot = simulation.botBySeat("B");
  const context = {
    focus: { id: enemy.id, x: enemy.x, y: enemy.y, visible: true, age: 0, source: "visible" },
    skillAggression: 1,
    trackableIntel: true,
  };
  bot.flagshipTimer = 0;
  bot.tryFlagshipSkill(context);
  assert.equal(simulation.teamB.wxAnchor.active, true, "AI must enter anchor near a visible target");
  simulation.elapsed = simulation.teamB.wxAnchor.activatedAt + 4.1;
  bot.flagshipTimer = 0;
  bot.tryFlagshipSkill(context);
  assert.equal(simulation.teamB.wxAnchor.active, false, "AI must release anchor outside the duel radius");
}

async function presentationContract() {
  const [
    characterText,
    chineseMessages,
    englishMessages,
    japaneseMessages,
    portraitSource,
    characterSelectSource,
    hudSource,
    onlineSource,
    soloSource,
    snapshotTransportSource,
    serverSource,
    renderSource,
  ] = await Promise.all([
    readFile(new URL("../src/i18n/character-text.js", import.meta.url), "utf8"),
    readFile(new URL("../src/i18n/messages-zh.js", import.meta.url), "utf8"),
    readFile(new URL("../src/i18n/messages-en.js", import.meta.url), "utf8"),
    readFile(new URL("../src/i18n/messages-ja.js", import.meta.url), "utf8"),
    readFile(new URL("../src/character-select/portraits.js", import.meta.url), "utf8"),
    readFile(new URL("../src/character-select.js", import.meta.url), "utf8"),
    readFile(new URL("../src/battle/hud.js", import.meta.url), "utf8"),
    readFile(new URL("../src/online.js", import.meta.url), "utf8"),
    readFile(new URL("../src/solo.js", import.meta.url), "utf8"),
    readFile(new URL("../src/online/snapshot-transport.js", import.meta.url), "utf8"),
    readFile(new URL("../server/server.js", import.meta.url), "utf8"),
    readFile(new URL("../src/battle/render.js", import.meta.url), "utf8"),
  ]);
  assert.match(characterText, /wx_emperor/);
  for (const text of ["皇权护体", "御驾亲征", "士气如虹"]) assert.match(chineseMessages, new RegExp(text));
  for (const text of ["Imperial Guard", "Imperial Campaign", "High Morale"]) assert.match(englishMessages, new RegExp(text));
  for (const text of ["皇権護体", "御駕親征", "士気如虹"]) assert.match(japaneseMessages, new RegExp(text));
  assert.match(portraitSource, /wx-emperor/);
  assert.match(characterSelectSource, /data-wx-skill-tab/);
  assert.match(characterSelectSource, /HAS_PORTRAIT[\s\S]*wx_emperor/);
  assert.match(hudSource, /updateWxAnchorStatus/);
  assert.match(hudSource, /selectedWxAnchored[\s\S]*brakeDisabled/);
  assert.match(onlineSource, /updateWxAnchorStatus\(ui, own\)/);
  assert.match(soloSource, /updateWxAnchorStatus\(ui, own\)/);
  assert.match(snapshotTransportSource, /privateWxAnchor/);
  assert.match(serverSource, /serializeWxAnchor\(room\.match\.teamA, \{ publicOnly: true \}\)/);
  assert.match(renderSource, /function buildWxAnchorVisualState/);
  assert.match(renderSource, /function drawComboFlashes/);
  assert.match(renderSource, /visualKind === "imperial_bolt"/);
  await Promise.all([
    access(new URL("../public/assets/portraits/blue/wx-emperor.webp", import.meta.url)),
    access(new URL("../public/assets/portraits/red/wx-emperor.webp", import.meta.url)),
  ]);
}

characterContract();
anchorLifecycleContract();
subAnchorAndDuelContract();
challengePrivacyContract();
imperialBuffContracts();
imperialCampaignContract();
anchorImmunityContract();
koizumiOrbAnchorResistanceContract();
compatibilityContract();
interpolationContract();
hudAvailabilityContract();
aiAnchorContract();
await presentationContract();

console.log("wx emperor core contracts passed");
