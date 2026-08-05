import {
  CHARACTER_ORDER,
  MatchSimulation,
  TICK_DT,
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
  const size = CHARACTER_ORDER.length;
  return {
    main: CHARACTER_ORDER[index % size],
    sub1: CHARACTER_ORDER[(index + 1) % size],
    sub2: CHARACTER_ORDER[(index + 2) % size],
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
}

function mergeCounters(target, source) {
  for (const key of Object.keys(target)) {
    for (const [name, value] of Object.entries(source[key])) {
      target[key][name] = (target[key][name] || 0) + value;
    }
  }
}

function runBattle({ index, loadoutA, loadoutB }) {
  const counters = {
    flagshipAttempts: {},
    flagshipCasts: {},
    subAttempts: {},
    subCasts: {},
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
  }

  const maxTicks = Math.ceil(MATCH_LIMIT_SECONDS / TICK_DT);
  let minEnergyRatio = 1;
  let minHullRatio = 1;
  let allShipsBlueoutTicks = 0;
  let radarContactTicks = 0;
  const combatScoutProjectileIds = new Set();
  for (let tick = 0; tick < maxTicks && simulation.phase === "running"; tick += 1) {
    simulation.update(TICK_DT);
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
    counters,
  };
}

const originalRandom = Math.random;
const totals = {
  flagshipAttempts: {},
  flagshipCasts: {},
  subAttempts: {},
  subCasts: {},
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
  skills: totals,
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
assert(summary.visionWaveBuffDeferrals > 0, "困难 AI 模拟对战从未触发朝仓视野波增益延迟");
for (const characterId of ["haruhi", "koizumi", "tsuruya", "asakura"]) {
  assert((totals.flagshipCasts[characterId] || 0) > 0, `${characterId} 旗舰主动技能在模拟对战中从未成功释放`);
}
for (const characterId of CHARACTER_ORDER) {
  assert((totals.subCasts[characterId] || 0) > 0, `${characterId} 分舰技能在模拟对战中从未成功释放`);
}
