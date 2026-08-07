import {
  CHARACTER_DEFS,
  CHARACTER_ORDER,
  MatchSimulation,
  TICK_DT,
  __resetEntityIds,
} from "../shared/game-core.js";

const MATCH_LIMIT_SECONDS = 210;
const SCENARIOS_PER_CHARACTER = Math.max(4, Number(process.env.SHAMISEN_BALANCE_SCENARIOS) || 8);
const TEST_CHARACTERS = process.env.SHAMISEN_BALANCE_ONLY === "1" ? ["shamisen"] : [...CHARACTER_ORDER];
const MAIN_POOL = ["haruhi", "koizumi", "yuki", "future1096", "kyon", "asakura"];
const OPPONENT_POOL = CHARACTER_ORDER.filter((characterId) => characterId !== "shamisen");

function applyNumericOverride(target, envKey, property) {
  const value = Number(process.env[envKey]);
  if (Number.isFinite(value) && value > 0) target[property] = value;
}

applyNumericOverride(CHARACTER_DEFS.shamisen.stats, "SHAMISEN_HP", "hp");
applyNumericOverride(CHARACTER_DEFS.shamisen.stats, "SHAMISEN_DAMAGE", "damage");
applyNumericOverride(CHARACTER_DEFS.shamisen.stats, "SHAMISEN_FIRE_RATE", "fireRate");
applyNumericOverride(CHARACTER_DEFS.shamisen.stats, "SHAMISEN_RANGE", "range");
applyNumericOverride(CHARACTER_DEFS.shamisen.subSkill, "SHAMISEN_BURST_DAMAGE", "burstDamage");
applyNumericOverride(CHARACTER_DEFS.shamisen.subSkill, "SHAMISEN_COOLDOWN", "cooldown");
applyNumericOverride(CHARACTER_DEFS.shamisen.subSkill, "SHAMISEN_COST", "cost");
applyNumericOverride(CHARACTER_DEFS.shamisen.subSkill, "SHAMISEN_DURATION", "duration");

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

function pickDistinct(pool, start, excluded, count) {
  const picks = [];
  for (let offset = 0; picks.length < count && offset < pool.length * 2; offset += 1) {
    const characterId = pool[(start + offset) % pool.length];
    if (!excluded.has(characterId) && !picks.includes(characterId)) picks.push(characterId);
  }
  return picks;
}

function loadoutsFor(testCharacterId, scenario) {
  let main = MAIN_POOL[scenario % MAIN_POOL.length];
  if (main === testCharacterId) main = MAIN_POOL[(scenario + 1) % MAIN_POOL.length];
  const [ally] = pickDistinct(OPPONENT_POOL, scenario + 2, new Set([main, testCharacterId]), 1);

  const opponentMain = MAIN_POOL[(scenario + 3) % MAIN_POOL.length];
  const opponentSubs = pickDistinct(OPPONENT_POOL, scenario + 4, new Set([opponentMain]), 2);
  return {
    test: { main, sub1: testCharacterId, sub2: ally },
    opponent: { main: opponentMain, sub1: opponentSubs[0], sub2: opponentSubs[1] },
  };
}

function instrumentBattle(testTeam, opponentTeam, testCharacterId, metrics) {
  const originalCastSubSkill = testTeam.castSubSkill.bind(testTeam);
  testTeam.castSubSkill = (shipKey, ...args) => {
    const cast = originalCastSubSkill(shipKey, ...args);
    if (cast && testTeam.ships[shipKey]?.characterId === testCharacterId) metrics.skillCasts += 1;
    return cast;
  };

  for (const ship of opponentTeam.getAllShips()) {
    const originalTakeDamage = ship.takeDamage.bind(ship);
    ship.takeDamage = (amount, source, match, share) => {
      const hpBefore = ship.hp;
      const result = originalTakeDamage(amount, source, match, share);
      if (source?.characterId === testCharacterId) metrics.damage += Math.max(0, hpBefore - ship.hp);
      return result;
    };

    const originalRegisterClawHit = ship.registerClawHit.bind(ship);
    ship.registerClawHit = (...args) => {
      metrics.clawHits += 1;
      const triggered = originalRegisterClawHit(...args);
      if (triggered) metrics.clawBursts += 1;
      return triggered;
    };
  }
}

function runBattle(testCharacterId, scenario, mirrored) {
  __resetEntityIds(1);
  const loadouts = loadoutsFor(testCharacterId, scenario);
  const testSeat = mirrored ? "B" : "A";
  const simulation = new MatchSimulation({
    mode: "pvp",
    worldSize: 1440,
    aiSeats: ["A", "B"],
    aiDifficulty: "master",
    teamLoadouts: mirrored
      ? { A: loadouts.opponent, B: loadouts.test }
      : { A: loadouts.test, B: loadouts.opponent },
  });
  const testTeam = simulation.teamBySeat(testSeat);
  const opponentTeam = simulation.enemyTeamBySeat(testSeat);
  const metrics = { skillCasts: 0, damage: 0, clawHits: 0, clawBursts: 0 };
  instrumentBattle(testTeam, opponentTeam, testCharacterId, metrics);

  const maxTicks = Math.ceil(MATCH_LIMIT_SECONDS / TICK_DT);
  for (let tick = 0; tick < maxTicks && simulation.phase === "running"; tick += 1) {
    simulation.update(TICK_DT);
  }
  const testedShip = testTeam.getAllShips().find((ship) => ship.characterId === testCharacterId);
  return {
    score: simulation.phase !== "finished" ? 0.5 : simulation.winnerSeat === testSeat ? 1 : 0,
    won: simulation.winnerSeat === testSeat,
    completed: simulation.phase === "finished",
    duration: simulation.elapsed,
    survived: Boolean(testedShip?.alive),
    ...metrics,
  };
}

function summarize(characterId, battles) {
  const count = battles.length;
  const sum = (key) => battles.reduce((total, battle) => total + Number(battle[key] || 0), 0);
  return {
    characterId,
    name: CHARACTER_DEFS[characterId].name,
    matches: count,
    scoreRate: Number((sum("score") / count).toFixed(3)),
    wins: sum("won"),
    completionRate: Number((sum("completed") / count).toFixed(3)),
    averageDurationSeconds: Number((sum("duration") / count).toFixed(1)),
    survivalRate: Number((sum("survived") / count).toFixed(3)),
    averageDamage: Number((sum("damage") / count).toFixed(1)),
    averageSkillCasts: Number((sum("skillCasts") / count).toFixed(2)),
    averageClawHits: Number((sum("clawHits") / count).toFixed(2)),
    averageClawBursts: Number((sum("clawBursts") / count).toFixed(2)),
  };
}

const originalRandom = Math.random;
const summaries = [];
try {
  for (const characterId of TEST_CHARACTERS) {
    const battles = [];
    for (let scenario = 0; scenario < SCENARIOS_PER_CHARACTER; scenario += 1) {
      for (const mirrored of [false, true]) {
        Math.random = seededRandom(0x5a17 + scenario * 7919 + (mirrored ? 31337 : 0));
        battles.push(runBattle(characterId, scenario, mirrored));
      }
    }
    summaries.push(summarize(characterId, battles));
  }
} finally {
  Math.random = originalRandom;
}

summaries.sort((left, right) => right.scoreRate - left.scoreRate);
const shamisen = summaries.find((item) => item.characterId === "shamisen");
const existing = summaries.filter((item) => item.characterId !== "shamisen");
const existingMedian = existing.length > 0
  ? [...existing].sort((a, b) => a.scoreRate - b.scoreRate)[Math.floor(existing.length / 2)]
  : null;

console.log(JSON.stringify({
  configuration: {
    scenariosPerCharacter: SCENARIOS_PER_CHARACTER,
    mirroredMatchesPerCharacter: SCENARIOS_PER_CHARACTER * 2,
    shamisenStats: CHARACTER_DEFS.shamisen.stats,
    shamisenSkill: CHARACTER_DEFS.shamisen.subSkill,
  },
  shamisen,
  existingMedian: existingMedian
    ? { characterId: existingMedian.characterId, scoreRate: existingMedian.scoreRate }
    : null,
  benchmarks: summaries,
}, null, 2));

if (!shamisen || shamisen.averageSkillCasts <= 0) throw new Error("三味线 AI 从未成功释放分舰技能");
if (shamisen.averageClawHits <= 0 || shamisen.averageClawBursts <= 0) throw new Error("三味线 AI 对战未形成有效猫爪连击");
