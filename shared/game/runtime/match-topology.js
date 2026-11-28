// 开局拓扑归一化：复制、校验并嵌套冻结舰队配置与展示色值，不消耗随机流或实体 ID。
import { DEFAULT_WORLD_SIZE } from "../foundation/constants.js";
import { CHARACTER_DEFS, DEFAULT_AI_LOADOUT, DEFAULT_TEAM_LOADOUT, normalizeLoadout } from "../characters/catalog.js";
import {
  FLEET_PRESENTATION_PALETTE,
  TEAM_COLORS,
  TEAM_HUNT_COLORS,
  TEAM_PROJECTILE_COLORS,
  normalizeAiSeats,
} from "../model/model-support.js";
import { isValidTopologyId } from "../rules/team-relations.js";
import { freezePlainData } from "../../data/plain-data.js";

const FORBIDDEN_INPUT_PRESENTATION_KEYS = Object.freeze([
  "presentation",
  "color",
  "projectileColor",
  "huntColor",
]);

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export const MIN_MULTI_FLEET_SPAWN_DISTANCE_RATIO = 0.12;
export const MULTI_FLEET_SPAWN_MARGIN_RATIO = 0.05;

export function defaultLegacySpawns(worldSize = DEFAULT_WORLD_SIZE) {
  const centerY = worldSize * 0.5;
  const zoneWidth = worldSize / 3;
  const spawnRetreat = zoneWidth * 0.25;
  const leftX = worldSize * 0.35 - spawnRetreat;
  const rightX = worldSize * 0.65 + spawnRetreat;
  return freezePlainData({
    A: { x: leftX, y: centerY, facing: 0 },
    B: { x: rightX, y: centerY, facing: Math.PI },
  });
}

function assertValidWorldSize(worldSize) {
  if (typeof worldSize !== "number" || !Number.isFinite(worldSize) || worldSize <= 0) {
    throw new RangeError(`非法地图尺寸 worldSize：${String(worldSize)}`);
  }
}

/**
 * 组队多舰队默认出生布局：左右两阵营沿纵轴错开摆放，面向中线，保证安全间距且不与旧双席重叠。
 */
export function defaultTeamSpawns(formatId, worldSize = DEFAULT_WORLD_SIZE) {
  assertValidWorldSize(worldSize);
  if (formatId === "2v2") {
    return freezePlainData({
      side1: [
        { x: worldSize * 0.22, y: worldSize * 0.3, facing: 0 },
        { x: worldSize * 0.22, y: worldSize * 0.7, facing: 0 },
      ],
      side2: [
        { x: worldSize * 0.78, y: worldSize * 0.3, facing: Math.PI },
        { x: worldSize * 0.78, y: worldSize * 0.7, facing: Math.PI },
      ],
    });
  }
  if (formatId === "3v3") {
    return freezePlainData({
      side1: [
        { x: worldSize * 0.2, y: worldSize * 0.22, facing: 0 },
        { x: worldSize * 0.2, y: worldSize * 0.5, facing: 0 },
        { x: worldSize * 0.2, y: worldSize * 0.78, facing: 0 },
      ],
      side2: [
        { x: worldSize * 0.8, y: worldSize * 0.22, facing: Math.PI },
        { x: worldSize * 0.8, y: worldSize * 0.5, facing: Math.PI },
        { x: worldSize * 0.8, y: worldSize * 0.78, facing: Math.PI },
      ],
    });
  }
  throw new Error(`不支持的组队出生布局格式：${String(formatId)}`);
}

/**
 * 混战多舰队默认出生布局：3 至 6 支舰队按正多边形均匀分布于中环并面向地图中心。
 */
export function defaultFfaSpawns(count, worldSize = DEFAULT_WORLD_SIZE) {
  assertValidWorldSize(worldSize);
  if (!Number.isInteger(count) || count < 3 || count > 6) {
    throw new RangeError(`混战出生布局仅支持 3 至 6 支舰队，收到：${String(count)}`);
  }
  const centerX = worldSize * 0.5;
  const centerY = worldSize * 0.5;
  const radius = worldSize * 0.34;
  const spawns = [];
  for (let index = 0; index < count; index += 1) {
    const theta = (Math.PI * 2 * index) / count - Math.PI * 0.5;
    const x = centerX + Math.cos(theta) * radius;
    const y = centerY + Math.sin(theta) * radius;
    const facing = Math.atan2(centerY - y, centerX - x);
    spawns.push({ x, y, facing });
  }
  return freezePlainData(spawns);
}

/**
 * 校验多舰队出生布局：保留安全边界余量并确保任意两支舰队间隔不小于最小出生距离。
 */
export function validateMultiFleetSpawns(fleets, worldSize = DEFAULT_WORLD_SIZE) {
  assertValidWorldSize(worldSize);
  const margin = worldSize * MULTI_FLEET_SPAWN_MARGIN_RATIO;
  const minDistance = worldSize * MIN_MULTI_FLEET_SPAWN_DISTANCE_RATIO;
  for (const fleet of fleets) {
    const { x, y } = fleet.spawn;
    if (x < margin || x > worldSize - margin || y < margin || y > worldSize - margin) {
      throw new Error(`舰队 ${fleet.seat} 的出生坐标距离地图边界过近，要求在 [${margin}, ${worldSize - margin}] 范围内`);
    }
  }
  for (let i = 0; i < fleets.length; i += 1) {
    for (let j = i + 1; j < fleets.length; j += 1) {
      const left = fleets[i];
      const right = fleets[j];
      const dist = Math.hypot(left.spawn.x - right.spawn.x, left.spawn.y - right.spawn.y);
      if (dist < minDistance) {
        throw new Error(
          `舰队 ${left.seat} 与 ${right.seat} 的出生距离过近（${Math.round(dist)} < ${Math.round(minDistance)}），禁止重叠出生`,
        );
      }
    }
  }
}

export function presentationForSeat(seat, seatIndex) {
  if (seat === "A" || seat === "B") {
    return {
      color: TEAM_COLORS[seat],
      projectileColor: TEAM_PROJECTILE_COLORS[seat],
      huntColor: TEAM_HUNT_COLORS[seat],
    };
  }
  const paletteIndex = Number.isInteger(seatIndex) && seatIndex >= 0
    ? seatIndex % FLEET_PRESENTATION_PALETTE.length
    : 0;
  const entry = FLEET_PRESENTATION_PALETTE[paletteIndex];
  return {
    color: entry.color,
    projectileColor: entry.projectileColor,
    huntColor: entry.huntColor,
  };
}

function validateStrictLoadout(loadout, seat) {
  if (!isPlainObject(loadout)) {
    throw new Error(`舰队 ${seat} 的阵容 loadout 必须是普通对象`);
  }
  const slots = ["main", "sub1", "sub2"];
  const used = new Set();
  const copied = {};
  for (const slot of slots) {
    if (!Object.hasOwn(loadout, slot)) {
      throw new Error(`舰队 ${seat} 的阵容缺少槽位 ${slot}`);
    }
    const characterId = loadout[slot];
    if (typeof characterId !== "string" || !Object.hasOwn(CHARACTER_DEFS, characterId)) {
      throw new Error(`舰队 ${seat} 的槽位 ${slot} 包含未知角色：${String(characterId)}`);
    }
    if (used.has(characterId)) {
      throw new Error(`舰队 ${seat} 的阵容存在重复角色：${characterId}`);
    }
    used.add(characterId);
    copied[slot] = characterId;
  }
  return copied;
}

function validateSpawn(spawn, worldSize, seat) {
  if (!isPlainObject(spawn)) {
    throw new Error(`舰队 ${seat} 缺少有效的出生坐标 spawn`);
  }
  const { x, y, facing } = spawn;
  if (typeof x !== "number" || !Number.isFinite(x)
    || typeof y !== "number" || !Number.isFinite(y)
    || typeof facing !== "number" || !Number.isFinite(facing)) {
    throw new Error(`舰队 ${seat} 的出生坐标和朝向必须是有限数值`);
  }
  if (x < 0 || x > worldSize || y < 0 || y > worldSize) {
    throw new Error(`舰队 ${seat} 的出生坐标超出地图范围 [0, ${worldSize}]`);
  }
  return { x, y, facing };
}

function resolveWorldSize(options, strict) {
  if (!Object.hasOwn(options, "worldSize") || options.worldSize === undefined) {
    return DEFAULT_WORLD_SIZE;
  }
  const value = options.worldSize;
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return value;
  }
  if (strict) {
    throw new Error(`非法地图尺寸 worldSize：${String(value)}`);
  }
  return DEFAULT_WORLD_SIZE;
}

export function normalizeMatchTopology(options = {}) {
  if (options === null || typeof options !== "object" || Array.isArray(options)) {
    throw new TypeError("对局拓扑配置必须是普通对象");
  }

  const hasExplicitFleets = Object.hasOwn(options, "fleets") && options.fleets !== undefined;
  const worldSize = resolveWorldSize(options, hasExplicitFleets);

  if (!hasExplicitFleets) {
    const mode = options.mode || "pvp";
    const aiSeats = normalizeAiSeats(mode, options.aiSeats, ["A", "B"], { legacyNormalize: true });
    const spawns = defaultLegacySpawns(worldSize);
    const loadoutA = normalizeLoadout(options.teamLoadouts?.A || DEFAULT_TEAM_LOADOUT, DEFAULT_TEAM_LOADOUT);
    const loadoutB = normalizeLoadout(
      options.teamLoadouts?.B || (aiSeats.includes("B") ? DEFAULT_AI_LOADOUT : DEFAULT_TEAM_LOADOUT),
      DEFAULT_TEAM_LOADOUT,
    );
    const fleets = [
      {
        seat: "A",
        sideId: "side1",
        name: options.teamNames?.A || (aiSeats.includes("A") ? "观察方AI舰队A" : "玩家A舰队"),
        loadout: { main: loadoutA.main, sub1: loadoutA.sub1, sub2: loadoutA.sub2 },
        spawn: { x: spawns.A.x, y: spawns.A.y, facing: spawns.A.facing },
        presentation: presentationForSeat("A", 0),
      },
      {
        seat: "B",
        sideId: "side2",
        name: options.teamNames?.B || (aiSeats.includes("B") ? "统合思念体AI舰队" : "玩家B舰队"),
        loadout: { main: loadoutB.main, sub1: loadoutB.sub1, sub2: loadoutB.sub2 },
        spawn: { x: spawns.B.x, y: spawns.B.y, facing: spawns.B.facing },
        presentation: presentationForSeat("B", 1),
      },
    ];
    return freezePlainData({
      fleets,
      seatOrder: ["A", "B"],
    });
  }

  // 显式 fleets 配置不允许与旧 teamNames / teamLoadouts 并存，避免产生不透明的覆盖语义。
  if (options.teamNames !== undefined || options.teamLoadouts !== undefined) {
    throw new Error("显式 fleets 配置不能与旧字段 teamNames 或 teamLoadouts 同时传入");
  }
  if (!Array.isArray(options.fleets) || options.fleets.length === 0) {
    throw new Error("显式 fleets 必须是非空数组");
  }

  const seenSeats = new Set();
  const fleets = [];
  const seatOrder = [];

  for (let index = 0; index < options.fleets.length; index += 1) {
    const item = options.fleets[index];
    if (!isPlainObject(item)) {
      throw new Error(`fleets[${index}] 必须是普通对象`);
    }
    // 展示颜色统一由归一化按契约派生，禁止从输入注入 presentation 或颜色字段。
    for (const forbiddenKey of FORBIDDEN_INPUT_PRESENTATION_KEYS) {
      if (Object.hasOwn(item, forbiddenKey)) {
        throw new Error(`舰队配置不允许从输入注入 ${forbiddenKey} 字段`);
      }
    }
    if (!isValidTopologyId(item.seat)) {
      throw new Error(`fleets[${index}] 的席位 seat 非法：${String(item.seat)}`);
    }
    if (seenSeats.has(item.seat)) {
      throw new Error(`舰队配置存在重复席位：${item.seat}`);
    }
    if (!isValidTopologyId(item.sideId)) {
      throw new Error(`舰队 ${item.seat} 缺少或包含非法阵营 sideId：${String(item.sideId)}`);
    }
    if (typeof item.name !== "string" || item.name.trim().length === 0) {
      throw new Error(`舰队 ${item.seat} 必须提供非空名称`);
    }

    const loadout = validateStrictLoadout(item.loadout, item.seat);
    const spawn = validateSpawn(item.spawn, worldSize, item.seat);
    seenSeats.add(item.seat);
    seatOrder.push(item.seat);
    fleets.push({
      seat: item.seat,
      sideId: item.sideId,
      name: item.name,
      loadout,
      spawn,
      presentation: presentationForSeat(item.seat, index),
    });
  }

  return freezePlainData({
    fleets,
    seatOrder,
  });
}
