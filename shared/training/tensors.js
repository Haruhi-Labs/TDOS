// 浏览器与 Node 共用的强化学习张量编码器。
// 此处必须与 training/src/haruhi_rl/tensors.py 逐元素一致，跨语言测试会验证该约束。

export const RL_TENSOR_SCHEMA_VERSION = 1;
export const RL_TOKEN_BUCKETS = 1024;

export const RL_TENSOR_LIMITS = Object.freeze({
  ownShips: 16,
  ownAuxiliaries: 128,
  opponents: 160,
  projectiles: 384,
  beams: 32,
  visionWaves: 32,
  radarContacts: 32,
  supporters: 8,
});

export const RL_ENCODED_MODEL_INPUT_NAMES = Object.freeze([
  "global",
  "support_tokens",
  "support_mask",
  "own_ships",
  "own_ships_mask",
  "own_ship_tokens",
  "own_aux",
  "own_aux_mask",
  "own_aux_tokens",
  "opponents",
  "opponents_mask",
  "opponent_tokens",
  "projectiles",
  "projectiles_mask",
  "projectile_tokens",
  "beams",
  "beams_mask",
  "beam_tokens",
  "vision_waves",
  "vision_waves_mask",
  "vision_wave_tokens",
  "radar",
  "radar_mask",
  "radar_tokens",
]);

export const RL_MODEL_INPUT_NAMES = Object.freeze([
  ...RL_ENCODED_MODEL_INPUT_NAMES,
  "hidden",
  "episode_start",
]);

export const RL_MODEL_OUTPUT_NAMES = Object.freeze([
  "next_hidden",
  "value",
  "ship_navigation_logits",
  "ship_set_gear_logits",
  "ship_gear_logits",
  "ship_brake_logits",
  "ship_subskill_logits",
  "ship_subzone_logits",
  "ship_continuous_mean",
  "ship_continuous_log_std",
  "split_logits",
  "scout_launch_logits",
  "scout_source_logits",
  "scout_zone_logits",
  "flagship_logits",
  "flagship_zone_logits",
  "flagship_continuous_mean",
  "flagship_continuous_log_std",
]);

const FEATURE_WIDTHS = Object.freeze({
  global: 19,
  own_ships: 45,
  own_aux: 13,
  opponents: 22,
  projectiles: 6,
  beams: 6,
  vision_waves: 6,
  radar: 8,
});

function finite(value, fallback = 0) {
  if (value === null || value === undefined || value === "") return fallback;
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function flag(value) {
  if (Array.isArray(value)) return value.length > 0 ? 1 : 0;
  if (value && typeof value === "object") return Object.keys(value).length > 0 ? 1 : 0;
  return value ? 1 : 0;
}

function ratio(value, maximum) {
  const denominator = finite(maximum);
  return denominator > 0 ? Math.max(0, finite(value) / denominator) : 0;
}

function utf8Bytes(value) {
  return new TextEncoder().encode(String(value));
}

export function rlToken(value, buckets = RL_TOKEN_BUCKETS) {
  if (value === null || value === undefined || value === "") return 0;
  let hashed = 2166136261;
  for (const byte of utf8Bytes(value)) {
    hashed = Math.imul((hashed ^ byte) >>> 0, 16777619) >>> 0;
  }
  return 1 + hashed % Math.max(1, buckets - 1);
}

function trackToken(value) {
  if (Number.isInteger(value)) {
    return 1 + ((value & 0x7fffffff) % (RL_TOKEN_BUCKETS - 1));
  }
  return rlToken(value);
}

function normalizedLimits(value = {}) {
  return {
    ownShips: finite(value.ownShips ?? value.own_ships, RL_TENSOR_LIMITS.ownShips),
    ownAuxiliaries: finite(
      value.ownAuxiliaries ?? value.own_auxiliaries,
      RL_TENSOR_LIMITS.ownAuxiliaries,
    ),
    opponents: finite(value.opponents, RL_TENSOR_LIMITS.opponents),
    projectiles: finite(value.projectiles, RL_TENSOR_LIMITS.projectiles),
    beams: finite(value.beams, RL_TENSOR_LIMITS.beams),
    visionWaves: finite(value.visionWaves ?? value.vision_waves, RL_TENSOR_LIMITS.visionWaves),
    radarContacts: finite(
      value.radarContacts ?? value.radar_contacts,
      RL_TENSOR_LIMITS.radarContacts,
    ),
    supporters: finite(value.supporters, RL_TENSOR_LIMITS.supporters),
  };
}

function floatTensor(dims) {
  return { type: "float32", dims, data: new Float32Array(dims.reduce((a, b) => a * b, 1)) };
}

function intTensor(dims) {
  return { type: "int64", dims, data: new BigInt64Array(dims.reduce((a, b) => a * b, 1)) };
}

function boolTensor(dims) {
  return { type: "bool", dims, data: new Uint8Array(dims.reduce((a, b) => a * b, 1)) };
}

function setRow(tensor, row, values) {
  const width = tensor.dims.at(-1);
  if (values.length !== width) {
    throw new RangeError(`强化学习特征宽度错误：期望 ${width}，实际 ${values.length}`);
  }
  tensor.data.set(values, row * width);
}

function matrix(items, capacity, width, extractor, label, strictOverflow) {
  if (strictOverflow && items.length > capacity) {
    throw new RangeError(`${label}实体数量 ${items.length} 超过张量容量 ${capacity}`);
  }
  const values = floatTensor([capacity, width]);
  const mask = boolTensor([capacity]);
  items.slice(0, capacity).forEach((item, index) => {
    setRow(values, index, extractor(item));
    mask.data[index] = 1;
  });
  return [values, mask];
}

function tokens(items, capacity, fields) {
  const result = intTensor([capacity, fields.length]);
  items.slice(0, capacity).forEach((item, row) => {
    fields.forEach(([field, encoder], column) => {
      result.data[row * fields.length + column] = BigInt(encoder(item?.[field]));
    });
  });
  return result;
}

function ownShipFeatures(item, width, height) {
  const angle = finite(item.angle);
  const limits = item.limits || {};
  const status = item.status || {};
  const claw = item.clawMarks || {};
  const routeValue = item.route;
  const route = routeValue || {};
  const p0 = route.p0 || {};
  const p1 = route.p1 || {};
  const p2 = route.p2 || {};
  return [
    flag(item.alive), flag(item.flagship), flag(item.auxiliary), flag(item.attached),
    flag(item.controllable), finite(item.x) / width, finite(item.y) / height,
    Math.sin(angle), Math.cos(angle), finite(item.speed) / 100, finite(item.radius) / 32,
    finite(item.throttle) / 1.4, ratio(item.hp, item.maxHp), finite(item.maxHp) / 1200,
    ratio(item.energy, item.maxEnergy), finite(item.maxEnergy) / 240,
    ratio(item.fleetEnergy, item.fleetMaxEnergy), finite(item.weaponCooldown) / 5,
    finite(item.skillCooldown) / 30, finite(item.brakeCooldown) / 3,
    finite(limits.speed) / 100, finite(limits.turnRate) / 1.5,
    finite(limits.acceleration) / 3, finite(limits.vision) / 360,
    finite(limits.range) / 900, finite(limits.damage) / 80, finite(limits.fireRate) / 2,
    flag(status.criticalVolley), flag(status.reliable), flag(status.bladeQueen),
    flag(status.catPawVolley), flag(status.emergencyBraking), flag(status.nextShotBoosted),
    flag(status.knockedBack), ratio(claw.stacks, claw.required), finite(claw.expiresIn) / 10,
    flag(routeValue), flag(route.anchorToMain), finite(p0.x) / width, finite(p0.y) / height,
    finite(p1.x) / width, finite(p1.y) / height, finite(p2.x) / width, finite(p2.y) / height,
    finite(route.progress),
  ];
}

function ownAuxFeatures(item, width, height) {
  const angle = finite(item.angle);
  return [
    flag(item.alive), finite(item.x) / width, finite(item.y) / height,
    Math.sin(angle), Math.cos(angle), finite(item.speed) / 140, finite(item.radius) / 16,
    ratio(item.hp, item.maxHp), finite(item.maxHp) / 200, finite(item.vision) / 360,
    finite(item.life) / 60, flag(item.combatCapable), finite(item.weaponCooldown) / 5,
  ];
}

function opponentFeatures(item, width, height) {
  const angle = finite(item.angle);
  const status = item.status || {};
  const claw = item.clawMarks || {};
  return [
    flag(item.alive), flag(item.attached), flag(item.characterConfirmed),
    finite(item.x) / width, finite(item.y) / height, Math.sin(angle), Math.cos(angle),
    finite(item.speed) / 100, finite(item.radius) / 32, ratio(item.hp, item.maxHp),
    finite(item.maxHp) / 1200, ratio(item.energy, item.maxEnergy),
    finite(item.maxEnergy) / 240, flag(status.criticalVolley), flag(status.reliable),
    flag(status.bladeQueen), flag(status.catPawVolley), flag(status.emergencyBraking),
    flag(status.nextShotBoosted), flag(status.knockedBack), ratio(claw.stacks, claw.required),
    finite(claw.expiresIn) / 10,
  ];
}

function encodeOne(frame, limits, strictOverflow) {
  const observation = frame.observation;
  const actionMask = frame.actionMask;
  const world = observation.world || {};
  const width = Math.max(1, finite(world.width, 1440));
  const height = Math.max(1, finite(world.height, width));
  const elapsed = Math.max(0, finite(world.elapsed));
  const own = observation.self || {};
  const ownEntities = own.entities || [];
  const ownShips = ownEntities.filter((item) => item.kind === "ship");
  const ownAux = ownEntities.filter((item) => item.kind !== "ship");
  const opponents = observation.opponent?.visibleEntities || [];
  const effects = observation.publicEffects || {};
  const radar = observation.privateSensors?.radar || {};

  const [ownShipValues, ownShipMask] = matrix(
    ownShips, limits.ownShips, FEATURE_WIDTHS.own_ships,
    (item) => ownShipFeatures(item, width, height), "己方舰船", strictOverflow,
  );
  const [ownAuxValues, ownAuxMask] = matrix(
    ownAux, limits.ownAuxiliaries, FEATURE_WIDTHS.own_aux,
    (item) => ownAuxFeatures(item, width, height), "己方辅助单位", strictOverflow,
  );
  const [opponentValues, opponentMask] = matrix(
    opponents, limits.opponents, FEATURE_WIDTHS.opponents,
    (item) => opponentFeatures(item, width, height), "可见敌方单位", strictOverflow,
  );

  const projectiles = effects.projectiles || [];
  const [projectileValues, projectileMask] = matrix(
    projectiles, limits.projectiles, FEATURE_WIDTHS.projectiles,
    (item) => [
      finite(item.x) / width, finite(item.y) / height, finite(item.targetX) / width,
      finite(item.targetY) / height, finite(item.speed) / 360, finite(item.radius) / 16,
    ],
    "公开弹丸", strictOverflow,
  );
  const beams = effects.beams || [];
  const [beamValues, beamMask] = matrix(
    beams, limits.beams, FEATURE_WIDTHS.beams,
    (item) => [
      finite(item.x1) / width, finite(item.y1) / height, finite(item.x2) / width,
      finite(item.y2) / height, finite(item.progress), ratio(item.life, item.maxLife),
    ],
    "公开光束", strictOverflow,
  );
  const waves = effects.visionWaves || [];
  const [waveValues, waveMask] = matrix(
    waves, limits.visionWaves, FEATURE_WIDTHS.vision_waves,
    (item) => [
      finite(item.x) / width, finite(item.y) / height,
      Math.max(0, elapsed - finite(item.emittedAt)) / 8, finite(item.speed) / 600,
      finite(item.width) / width, Math.max(0, finite(item.expiresAt) - elapsed) / 8,
    ],
    "公开视野波", strictOverflow,
  );
  const contacts = radar.contacts || [];
  const [radarValues, radarMask] = matrix(
    contacts, limits.radarContacts, FEATURE_WIDTHS.radar,
    (item) => [
      finite(item.x) / width, finite(item.y) / height, Math.sin(finite(item.angle)),
      Math.cos(finite(item.angle)), finite(item.clarity), finite(item.uncertainty) / width,
      Math.max(0, elapsed - finite(item.detectedAt)) / 5,
      Math.max(0, finite(item.expiresAt) - elapsed) / 5,
    ],
    "私有雷达回波", strictOverflow,
  );

  const cooldowns = own.cooldowns || {};
  const ownEffects = own.effects || {};
  const haruhi = own.haruhi || {};
  const radarAngle = finite(radar.angle);
  const global = floatTensor([FEATURE_WIDTHS.global]);
  global.data.set([
    width / 1440, height / 1440, finite(world.padding) / width, elapsed / 180,
    finite(own.splitLevel) / 2, finite(cooldowns.scout) / 30,
    finite(cooldowns.flagship) / 30, flag(own.skillsDisabled), flag(own.scoutsDisabled),
    flag(ownEffects.accelerationBoost), flag(ownEffects.invulnerable), flag(ownEffects.sponsor),
    flag(ownEffects.visionWave), flag(ownEffects.haruhiBroadcast), flag(haruhi.otherworlderReady),
    flag(radar.active), Math.sin(radarAngle), Math.cos(radarAngle),
    finite(radar.angularVelocity) / Math.PI,
  ]);

  const supportValues = own.haruhi?.supportTokens || [];
  if (strictOverflow && supportValues.length > limits.supporters) {
    throw new RangeError(
      `常驻支援数量 ${supportValues.length} 超过张量容量 ${limits.supporters}`,
    );
  }
  const supportTokens = intTensor([limits.supporters]);
  const supportMask = boolTensor([limits.supporters]);
  supportValues.slice(0, limits.supporters).forEach((value, index) => {
    supportTokens.data[index] = BigInt(rlToken(value));
    supportMask.data[index] = 1;
  });

  const actionByKey = new Map(
    (actionMask.ships || []).map((item) => [String(item.controlKey), item]),
  );
  const navigationMask = boolTensor([limits.ownShips, 3]);
  const gearMask = boolTensor([limits.ownShips, 5]);
  const shipActionFlags = boolTensor([limits.ownShips, 5]);
  ownShips.slice(0, limits.ownShips).forEach((ship, index) => {
    const mask = actionByKey.get(String(ship.controlKey)) || {};
    (mask.navigation || []).slice(0, 3).forEach((value, column) => {
      navigationMask.data[index * 3 + column] = value ? 1 : 0;
    });
    (mask.gear || []).slice(0, 5).forEach((value, column) => {
      gearMask.data[index * 5 + column] = value ? 1 : 0;
    });
    [mask.setGear, mask.emergencyBrake, mask.castSubSkill, mask.subSkillPoint, mask.subSkillZone]
      .forEach((value, column) => {
        shipActionFlags.data[index * 5 + column] = value ? 1 : 0;
      });
  });

  const scout = actionMask.scout || {};
  const scoutSourceMask = boolTensor([limits.ownShips]);
  (scout.sourceShips || []).slice(0, limits.ownShips).forEach((value, index) => {
    scoutSourceMask.data[index] = value ? 1 : 0;
  });
  const splitMask = boolTensor([3]);
  (actionMask.split || [true, false, false]).slice(0, 3).forEach((value, index) => {
    splitMask.data[index] = value ? 1 : 0;
  });
  const scoutZoneMask = boolTensor([9]);
  (scout.zones || Array(9).fill(true)).slice(0, 9).forEach((value, index) => {
    scoutZoneMask.data[index] = value ? 1 : 0;
  });
  const flagshipParameters = boolTensor([2]);
  flagshipParameters.data.set([
    actionMask.flagshipSkill?.point ? 1 : 0,
    actionMask.flagshipSkill?.zone ? 1 : 0,
  ]);

  const flagshipToken = intTensor([]);
  flagshipToken.data[0] = BigInt(rlToken(own.flagshipCharacterToken));
  const futureFormToken = intTensor([]);
  futureFormToken.data[0] = BigInt(rlToken(own.futureFormToken));
  const scoutLaunch = boolTensor([]);
  scoutLaunch.data[0] = scout.launch ? 1 : 0;
  const flagship = boolTensor([]);
  flagship.data[0] = actionMask.flagshipSkill?.cast ? 1 : 0;

  return {
    global,
    flagship_token: flagshipToken,
    future_form_token: futureFormToken,
    support_tokens: supportTokens,
    support_mask: supportMask,
    own_ships: ownShipValues,
    own_ships_mask: ownShipMask,
    own_ship_tokens: tokens(ownShips, limits.ownShips, [
      ["characterToken", rlToken], ["slotToken", rlToken], ["id", trackToken],
    ]),
    own_aux: ownAuxValues,
    own_aux_mask: ownAuxMask,
    own_aux_tokens: tokens(ownAux, limits.ownAuxiliaries, [
      ["kind", rlToken], ["id", trackToken],
    ]),
    opponents: opponentValues,
    opponents_mask: opponentMask,
    opponent_tokens: tokens(opponents, limits.opponents, [
      ["kind", rlToken], ["characterToken", rlToken], ["id", trackToken],
    ]),
    projectiles: projectileValues,
    projectiles_mask: projectileMask,
    projectile_tokens: tokens(projectiles, limits.projectiles, [
      ["relation", rlToken], ["visualToken", rlToken], ["id", trackToken],
    ]),
    beams: beamValues,
    beams_mask: beamMask,
    beam_tokens: tokens(beams, limits.beams, [
      ["relation", rlToken], ["phaseToken", rlToken], ["id", trackToken],
    ]),
    vision_waves: waveValues,
    vision_waves_mask: waveMask,
    vision_wave_tokens: tokens(waves, limits.visionWaves, [
      ["relation", rlToken], ["id", trackToken],
    ]),
    radar: radarValues,
    radar_mask: radarMask,
    radar_tokens: tokens(contacts, limits.radarContacts, [
      ["echoToken", rlToken], ["characterToken", rlToken], ["contactToken", trackToken],
    ]),
    action_navigation_mask: navigationMask,
    action_gear_mask: gearMask,
    action_ship_flags: shipActionFlags,
    action_split_mask: splitMask,
    action_scout_launch: scoutLaunch,
    action_scout_source_mask: scoutSourceMask,
    action_scout_zone_mask: scoutZoneMask,
    action_flagship: flagship,
    action_flagship_parameters: flagshipParameters,
  };
}

function batchTensor(values) {
  const first = values[0];
  const dims = [values.length, ...first.dims];
  const result = first.type === "float32"
    ? floatTensor(dims)
    : first.type === "int64"
      ? intTensor(dims)
      : boolTensor(dims);
  const stride = first.data.length;
  values.forEach((value, index) => {
    if (value.type !== first.type || value.data.length !== stride) {
      throw new TypeError("强化学习批张量结构不一致");
    }
    result.data.set(value.data, index * stride);
  });
  return result;
}

export function encodeRlFrames(
  frames,
  { limits: rawLimits = RL_TENSOR_LIMITS, strictOverflow = true } = {},
) {
  if (!Array.isArray(frames) || frames.length === 0) {
    throw new TypeError("至少需要一个席位观察");
  }
  const limits = normalizedLimits(rawLimits);
  const encoded = frames.map((frame) => encodeOne(frame, limits, strictOverflow));
  return Object.fromEntries(
    Object.keys(encoded[0]).map((name) => [
      name,
      batchTensor(encoded.map((item) => item[name])),
    ]),
  );
}

export function serializeRlTensors(tensors) {
  return Object.fromEntries(Object.entries(tensors).map(([name, tensor]) => [name, {
    type: tensor.type,
    dims: tensor.dims,
    data: Array.from(tensor.data, (value) => typeof value === "bigint" ? Number(value) : value),
  }]));
}
