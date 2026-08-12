import {
  CHARACTER_ORDER,
  MatchSimulation,
  TICK_DT,
  __resetEntityIds,
  distance,
} from "../shared/game-core.js";

const MATCH_LIMIT_SECONDS = 240;
const MIRRORED_ROUNDS = 2;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function seededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function loadoutAt(index) {
  const mainOrder = CHARACTER_ORDER;
  const main = mainOrder[index % mainOrder.length];
  const subOrder = CHARACTER_ORDER.filter((characterId) => characterId !== main);
  return {
    main,
    sub1: subOrder[(index + 1) % subOrder.length],
    sub2: subOrder[(index + 2) % subOrder.length],
  };
}

function increment(counter, key) {
  counter[key] = (counter[key] || 0) + 1;
}

function instrumentSkills(team, counters) {
  const castFlagshipSkill = team.castFlagshipSkill.bind(team);
  team.castFlagshipSkill = (...args) => {
    increment(counters.flagshipAttempts, team.mainCharacterId());
    const cast = castFlagshipSkill(...args);
    if (cast) increment(counters.flagshipCasts, team.mainCharacterId());
    return cast;
  };

  const castSubSkill = team.castSubSkill.bind(team);
  team.castSubSkill = (shipKey, ...args) => {
    const characterId = team.ships[shipKey]?.characterId || "unknown";
    increment(counters.subAttempts, characterId);
    const cast = castSubSkill(shipKey, ...args);
    if (cast) increment(counters.subCasts, characterId);
    return cast;
  };

  const launchScout = team.launchScout.bind(team);
  team.launchScout = (zoneId, ...args) => {
    const launched = launchScout(zoneId, ...args);
    if (launched) {
      const characterId = team.mainCharacterId();
      increment(counters.scoutLaunches, characterId);
      increment(counters.scoutZones, `${characterId}:${Number(zoneId) || 5}`);
    }
    return launched;
  };
}

function mergeCounters(target, source) {
  for (const key of Object.keys(target)) {
    for (const [name, value] of Object.entries(source[key])) {
      target[key][name] = (target[key][name] || 0) + value;
    }
  }
}

function runBattle({ index, loadoutA, loadoutB }) {
  __resetEntityIds(1);
  const counters = {
    flagshipAttempts: {},
    flagshipCasts: {},
    subAttempts: {},
    subCasts: {},
    scoutLaunches: {},
    scoutZones: {},
    scoutRetasks: {},
  };
  const simulation = new MatchSimulation({
    mode: "pvp",
    worldSize: 1440,
    aiSeats: ["A", "B"],
    aiDifficulty: "master",
    teamLoadouts: { A: loadoutA, B: loadoutB },
  });
  instrumentSkills(simulation.teamA, counters);
  instrumentSkills(simulation.teamB, counters);
  let visionWaveBuffDeferrals = 0;
  for (const bot of Object.values(simulation.bots)) {
    const incomingVisionWaveWillPurge = bot.incomingVisionWaveWillPurge.bind(bot);
    bot.incomingVisionWaveWillPurge = (...args) => {
      const shouldDefer = incomingVisionWaveWillPurge(...args);
      if (shouldDefer) visionWaveBuffDeferrals += 1;
      return shouldDefer;
    };
    const retaskYukiCombatScouts = bot.retaskYukiCombatScouts.bind(bot);
    bot.retaskYukiCombatScouts = (...args) => {
      const retasked = retaskYukiCombatScouts(...args);
      if (retasked > 0) {
        const characterId = bot.team.mainCharacterId();
        counters.scoutRetasks[characterId] = (counters.scoutRetasks[characterId] || 0) + retasked;
      }
      return retasked;
    };
  }

  const maxTicks = Math.ceil(MATCH_LIMIT_SECONDS / TICK_DT);
  let minEnergyRatio = 1;
  let minHullRatio = 1;
  let allShipsBlueoutTicks = 0;
  let radarContactTicks = 0;
  let barrierDefenseTicks = 0;
  let barrierCounterplayTicks = 0;
  let barrierBreachWindowTicks = 0;
  const barrierImpactIds = new Set();
  const barrierImpacts = {
    projectile: 0,
    beam: 0,
    ram: 0,
  };
  const combatScoutProjectileIds = new Set();
  for (let tick = 0; tick < maxTicks && simulation.phase === "running"; tick += 1) {
    simulation.update(TICK_DT);
    for (const bot of Object.values(simulation.bots)) {
      const tactics = bot.currentContext?.barrierTactics;
      if (tactics?.own?.active) barrierDefenseTicks += 1;
      if (
        tactics?.enemy?.active
        && (tactics.breachShipKey || tactics.infiltration?.shipKeys?.length)
      ) {
        barrierCounterplayTicks += 1;
      }
      if (tactics?.enemy && !tactics.enemy.active && tactics.enemy.disabledRemaining > 0) {
        barrierBreachWindowTicks += 1;
      }
    }
    for (const impact of simulation.koizumiBarrierImpacts) {
      if (barrierImpactIds.has(impact.id)) continue;
      barrierImpactIds.add(impact.id);
      if (Object.hasOwn(barrierImpacts, impact.kind)) {
        barrierImpacts[impact.kind] += 1;
      }
    }
    const combatScoutIds = new Set(
      [...simulation.teamA.scouts, ...simulation.teamB.scouts]
        .filter((scout) => scout.combatCapable)
        .map((scout) => scout.id),
    );
    for (const projectile of simulation.projectiles) {
      if (combatScoutIds.has(projectile.sourceId)) {
        combatScoutProjectileIds.add(projectile.id);
      }
    }
    const ships = [...simulation.teamA.getAllShips(), ...simulation.teamB.getAllShips()].filter((ship) => ship.alive);
    const fleetEnergyRatios = [simulation.teamA, simulation.teamB].map((team) => {
      const alive = team.getAllShips().filter((ship) => ship.alive);
      return alive.reduce((sum, ship) => sum + ship.energy, 0)
        / Math.max(1, alive.reduce((sum, ship) => sum + ship.maxEnergy, 0));
    });
    if (fleetEnergyRatios.every((ratio) => ratio < 0.03)) allShipsBlueoutTicks += 1;
    for (const ship of ships) {
      assert(
        [ship.x, ship.y, ship.hp, ship.energy, ship.speed, ship.angle].every(Number.isFinite),
        `第${index + 1}局出现非有限舰船状态`,
      );
      assert(ship.energy >= -1e-7, `第${index + 1}局出现负能量`);
      minEnergyRatio = Math.min(minEnergyRatio, ship.energy / Math.max(1, ship.maxEnergy));
    }
    minHullRatio = Math.min(minHullRatio, simulation.teamA.hullRatio(), simulation.teamB.hullRatio());
    if (simulation.teamA.radarPassive.contacts.size > 0 || simulation.teamB.radarPassive.contacts.size > 0) {
      radarContactTicks += 1;
    }
  }

  return {
    index: index + 1,
    loadoutA,
    loadoutB,
    winner: simulation.winnerSeat,
    completed: simulation.phase === "finished",
    durationSeconds: Number(simulation.elapsed.toFixed(2)),
    minHullRatio: Number(minHullRatio.toFixed(4)),
    minEnergyRatio: Number(minEnergyRatio.toFixed(4)),
    allShipsBlueoutRatio: Number((allShipsBlueoutTicks / Math.max(1, simulation.tick)).toFixed(4)),
    radarContactTicks,
    combatScoutShots: combatScoutProjectileIds.size,
    visionWaveBuffDeferrals,
    barrierDefenseTicks,
    barrierCounterplayTicks,
    barrierBreachWindowTicks,
    barrierImpacts,
    counters,
  };
}

function runBarrierBreachScenario(breakerKind, seed) {
  __resetEntityIds(1);
  const isHaruhi = breakerKind === "haruhi_otherworlder";
  const breakerCharacter = breakerKind === "blade_queen" ? "asakura" : "koizumi";
  const simulation = new MatchSimulation({
    mode: "pvp",
    worldSize: 1440,
    aiSeats: ["B"],
    aiDifficulty: "master",
    teamLoadouts: {
      A: { main: "koizumi", sub1: "yuki", sub2: "shamisen" },
      B: isHaruhi
        ? { main: "haruhi", sub1: "yuki", sub2: "future1096" }
        : { main: "kyon", sub1: breakerCharacter, sub2: "yuki" },
    },
  });
  simulation.setCombatEnabled("A", false);
  simulation.setCombatEnabled("B", false);
  const defendingMain = simulation.teamA.ships.main;
  const attackingTeam = simulation.teamB;
  const bot = simulation.botBySeat("B");
  const breaker = isHaruhi ? attackingTeam.ships.main : attackingTeam.ships.sub1;
  if (!isHaruhi) attackingTeam.split(1);
  if (isHaruhi) {
    attackingTeam.haruhiFlagship.supporters.add("otherworlder");
    attackingTeam.haruhiFlagship.otherworlderReadyAt = simulation.elapsed;
    bot.flagshipTimer = 999;
  } else {
    bot.subTimers.sub1 = 0;
  }

  defendingMain.x = 650;
  defendingMain.y = 720;
  defendingMain.command = { x: defendingMain.x, y: defendingMain.y };
  defendingMain.route = null;
  breaker.x = 940;
  breaker.y = 720;
  breaker.angle = Math.PI;
  breaker.energy = breaker.maxEnergy;
  breaker.command = { x: breaker.x, y: breaker.y };
  breaker.route = null;
  attackingTeam.ships.main.x = isHaruhi ? breaker.x : 1010;
  attackingTeam.ships.main.y = 720;
  bot.moveTimer = 0;
  bot.rememberContact(defendingMain, "visible");

  const previousRandom = Math.random;
  Math.random = seededRandom(seed);
  try {
    const maximumTicks = Math.ceil(14 / TICK_DT);
    for (let tick = 0; tick < maximumTicks; tick += 1) {
      simulation.update(TICK_DT);
      const impact = simulation.koizumiBarrierImpacts.find(
        (item) => item.kind === "ram" && item.ramKind === breakerKind,
      );
      if (impact) {
        return {
          breakerKind,
          breached: true,
          breachedAt: Number(simulation.elapsed.toFixed(2)),
        };
      }
    }
  } finally {
    Math.random = previousRandom;
  }
  return {
    breakerKind,
    breached: false,
    breachedAt: null,
  };
}

function runBarrierInfiltrationScenario(seed) {
  __resetEntityIds(1);
  const simulation = new MatchSimulation({
    mode: "pvp",
    worldSize: 1440,
    aiSeats: ["B"],
    aiDifficulty: "master",
    teamLoadouts: {
      A: { main: "koizumi", sub1: "yuki", sub2: "tsuruya" },
      B: { main: "kyon", sub1: "yuki", sub2: "shamisen" },
    },
  });
  simulation.setCombatEnabled("A", false);
  const defendingMain = simulation.teamA.ships.main;
  const attackingTeam = simulation.teamB;
  const attackingMain = attackingTeam.ships.main;
  const bot = simulation.botBySeat("B");
  defendingMain.x = 650;
  defendingMain.y = 720;
  defendingMain.command = { x: defendingMain.x, y: defendingMain.y };
  defendingMain.route = null;
  attackingMain.x = 930;
  attackingMain.y = 720;
  attackingMain.angle = Math.PI;
  attackingMain.command = { x: attackingMain.x, y: attackingMain.y };
  attackingMain.route = null;
  bot.moveTimer = 0;
  bot.rememberContact(defendingMain, "visible");

  let maximumInsideCount = 0;
  let sawStage = false;
  let sawCommit = false;
  const previousRandom = Math.random;
  Math.random = seededRandom(seed);
  try {
    const maximumTicks = Math.ceil(30 / TICK_DT);
    for (let tick = 0; tick < maximumTicks; tick += 1) {
      simulation.update(TICK_DT);
      const tactics = bot.currentContext?.barrierTactics;
      sawStage ||= tactics?.infiltration?.phase === "stage";
      sawCommit ||= tactics?.infiltration?.phase === "commit";
      const radius = tactics?.enemy?.radius || defendingMain.effectiveVision();
      const insideCount = attackingTeam.getPlayerShips().filter((ship) => (
        ship.alive
        && distance(ship.x, ship.y, defendingMain.x, defendingMain.y)
          <= radius - Math.max(8, ship.radius)
      )).length;
      maximumInsideCount = Math.max(maximumInsideCount, insideCount);
    }
  } finally {
    Math.random = previousRandom;
  }
  return {
    sawStage,
    sawCommit,
    maximumInsideCount,
    defenderHullRatio: Number(simulation.teamA.hullRatio().toFixed(4)),
    barrierWasDisrupted: Number.isFinite(simulation.teamA.koizumiBarrier.disabledAt),
  };
}

const originalRandom = Math.random;
const totals = {
  flagshipAttempts: {},
  flagshipCasts: {},
  subAttempts: {},
  subCasts: {},
  scoutLaunches: {},
  scoutZones: {},
  scoutRetasks: {},
};
const results = [];
try {
  let matchIndex = 0;
  for (let round = 0; round < MIRRORED_ROUNDS; round += 1) {
    for (let index = 0; index < CHARACTER_ORDER.length; index += 1) {
      Math.random = seededRandom(0x5a17 + matchIndex * 7919);
      const left = loadoutAt(index);
      const right = loadoutAt(index + 3);
      const result = runBattle({
        index: matchIndex,
        loadoutA: round === 0 ? left : right,
        loadoutB: round === 0 ? right : left,
      });
      results.push(result);
      mergeCounters(totals, result.counters);
      matchIndex += 1;
    }
  }
} finally {
  Math.random = originalRandom;
}

const completed = results.filter((result) => result.completed);
const damaged = results.filter((result) => result.minHullRatio < 0.995);
const barrierBreachScenarios = [
  runBarrierBreachScenario("blade_queen", 0xb1ade),
  runBarrierBreachScenario("koizumi_orb", 0x0b12),
  runBarrierBreachScenario("haruhi_otherworlder", 0xa117),
];
const barrierInfiltrationScenario = runBarrierInfiltrationScenario(0x1f117);
const summary = {
  matches: results.length,
  completed: completed.length,
  draws: results.length - completed.length,
  completionRate: Number((completed.length / results.length).toFixed(3)),
  averageDurationSeconds: Number(
    (results.reduce((sum, result) => sum + result.durationSeconds, 0) / results.length).toFixed(2),
  ),
  wins: {
    A: results.filter((result) => result.winner === "A").length,
    B: results.filter((result) => result.winner === "B").length,
  },
  minimumEnergyRatio: Math.min(...results.map((result) => result.minEnergyRatio)),
  maximumBlueoutRatio: Math.max(...results.map((result) => result.allShipsBlueoutRatio)),
  radarContactTicks: results.reduce((sum, result) => sum + result.radarContactTicks, 0),
  combatScoutShots: results.reduce((sum, result) => sum + result.combatScoutShots, 0),
  visionWaveBuffDeferrals: results.reduce((sum, result) => sum + result.visionWaveBuffDeferrals, 0),
  barrierTactics: {
    defenseTicks: results.reduce((sum, result) => sum + result.barrierDefenseTicks, 0),
    counterplayTicks: results.reduce((sum, result) => sum + result.barrierCounterplayTicks, 0),
    breachWindowTicks: results.reduce((sum, result) => sum + result.barrierBreachWindowTicks, 0),
    projectileBlocks: results.reduce((sum, result) => sum + result.barrierImpacts.projectile, 0),
    beamBlocks: results.reduce((sum, result) => sum + result.barrierImpacts.beam, 0),
    ramBreaches: results.reduce((sum, result) => sum + result.barrierImpacts.ram, 0),
    fixedBreachScenarios: barrierBreachScenarios,
    noBreakerInfiltration: barrierInfiltrationScenario,
  },
  scoutTactics: {
    yukiLaunches: totals.scoutLaunches.yuki || 0,
    yukiRetasks: totals.scoutRetasks.yuki || 0,
    yukiZones: Object.keys(totals.scoutZones).filter((key) => key.startsWith("yuki:")).length,
  },
  skills: {
    flagshipAttempts: totals.flagshipAttempts,
    flagshipCasts: totals.flagshipCasts,
    subAttempts: totals.subAttempts,
    subCasts: totals.subCasts,
  },
};

console.log(JSON.stringify(summary, null, 2));
if (process.env.AI_SIM_DETAILS === "1") {
  console.log(JSON.stringify({ matches: results }, null, 2));
}

assert(damaged.length === results.length, "存在整局未造成伤害的 AI 对战");
assert(summary.completionRate >= 0.7, `AI 对战完成率过低：${summary.completionRate}`);
assert(summary.maximumBlueoutRatio < 0.12, `双方同时耗尽能量的时间占比过高：${summary.maximumBlueoutRatio}`);
assert(summary.radarContactTicks > 0, "包含长门旗舰的模拟对战从未产生雷达接触");
assert(summary.combatScoutShots > 0, "包含长门旗舰的模拟对战中，战斗僚机从未成功开火");
assert(summary.scoutTactics.yukiLaunches > 0, "长门旗舰AI在模拟对战中从未释放战斗僚机");
assert(summary.scoutTactics.yukiZones >= 3, "长门旗舰AI在模拟对战中没有形成多战区部署");
assert(summary.scoutTactics.yukiRetasks > 0, "长门旗舰AI在模拟对战中从未重新编组战斗僚机");
assert(summary.visionWaveBuffDeferrals > 0, "困难 AI 模拟对战从未触发朝仓视野波增益延迟");
assert(summary.barrierTactics.defenseTicks > 0, "包含古泉旗舰的模拟对战从未进入能量圈防守战术");
assert(summary.barrierTactics.counterplayTicks > 0, "AI 从未对已识别的古泉能量圈组织破盾或渗透");
assert(summary.barrierTactics.projectileBlocks + summary.barrierTactics.beamBlocks > 0, "古泉能量圈在模拟对战中从未实际拦截远程攻击");
assert(
  barrierBreachScenarios.every((scenario) => scenario.breached),
  `固定阵容破盾模拟失败：${barrierBreachScenarios.filter((scenario) => !scenario.breached).map((scenario) => scenario.breakerKind).join(",")}`,
);
assert(
  barrierInfiltrationScenario.sawStage
    && barrierInfiltrationScenario.sawCommit
    && barrierInfiltrationScenario.maximumInsideCount >= 2
    && barrierInfiltrationScenario.defenderHullRatio < 0.9
    && !barrierInfiltrationScenario.barrierWasDisrupted,
  `无破盾阵容常规突入模拟失败：${JSON.stringify(barrierInfiltrationScenario)}`,
);
for (const characterId of ["haruhi", "tsuruya", "asakura"]) {
  assert((totals.flagshipCasts[characterId] || 0) > 0, `${characterId} 旗舰主动技能在模拟对战中从未成功释放`);
}
for (const characterId of CHARACTER_ORDER) {
  assert((totals.subCasts[characterId] || 0) > 0, `${characterId} 分舰技能在模拟对战中从未成功释放`);
}
