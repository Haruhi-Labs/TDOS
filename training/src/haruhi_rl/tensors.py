"""把公平结构化观察编码为可批处理的实体张量。"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Any, Callable, Iterable, Mapping, Sequence

import numpy as np
import torch


@dataclass(frozen=True)
class TensorLimits:
    """为当前 1v1 和未来 3v3 预留的实体容量；溢出默认报错。"""

    own_ships: int = 16
    own_auxiliaries: int = 128
    opponents: int = 160
    projectiles: int = 384
    beams: int = 32
    vision_waves: int = 32
    radar_contacts: int = 32
    supporters: int = 8


TOKEN_BUCKETS = 1024

GLOBAL_FEATURE_NAMES = (
    "world_width",
    "world_height",
    "world_padding",
    "elapsed",
    "split_level",
    "scout_cooldown",
    "flagship_cooldown",
    "skills_disabled",
    "scouts_disabled",
    "acceleration_boost",
    "invulnerable",
    "sponsor",
    "vision_wave",
    "haruhi_broadcast",
    "otherworlder_ready",
    "radar_active",
    "radar_angle_sin",
    "radar_angle_cos",
    "radar_angular_velocity",
)

OWN_SHIP_FEATURE_NAMES = (
    "alive",
    "flagship",
    "auxiliary",
    "attached",
    "controllable",
    "x",
    "y",
    "angle_sin",
    "angle_cos",
    "speed",
    "radius",
    "throttle",
    "hp_ratio",
    "max_hp",
    "energy_ratio",
    "max_energy",
    "fleet_energy_ratio",
    "weapon_cooldown",
    "skill_cooldown",
    "brake_cooldown",
    "limit_speed",
    "limit_turn_rate",
    "limit_acceleration",
    "limit_vision",
    "limit_range",
    "limit_damage",
    "limit_fire_rate",
    "critical_volley",
    "reliable",
    "blade_queen",
    "cat_paw_volley",
    "emergency_braking",
    "next_shot_boosted",
    "knocked_back",
    "claw_ratio",
    "claw_expires",
    "has_route",
    "route_anchor_to_main",
    "route_p0_x",
    "route_p0_y",
    "route_p1_x",
    "route_p1_y",
    "route_p2_x",
    "route_p2_y",
    "route_progress",
)

OWN_AUX_FEATURE_NAMES = (
    "alive",
    "x",
    "y",
    "angle_sin",
    "angle_cos",
    "speed",
    "radius",
    "hp_ratio",
    "max_hp",
    "vision",
    "life",
    "combat_capable",
    "weapon_cooldown",
)

OPPONENT_FEATURE_NAMES = (
    "alive",
    "attached",
    "character_confirmed",
    "x",
    "y",
    "angle_sin",
    "angle_cos",
    "speed",
    "radius",
    "hp_ratio",
    "max_hp",
    "energy_ratio",
    "max_energy",
    "critical_volley",
    "reliable",
    "blade_queen",
    "cat_paw_volley",
    "emergency_braking",
    "next_shot_boosted",
    "knocked_back",
    "claw_ratio",
    "claw_expires",
)

PROJECTILE_FEATURE_NAMES = (
    "x",
    "y",
    "target_x",
    "target_y",
    "speed",
    "radius",
)

BEAM_FEATURE_NAMES = (
    "x1",
    "y1",
    "x2",
    "y2",
    "progress",
    "life_ratio",
)

VISION_WAVE_FEATURE_NAMES = (
    "x",
    "y",
    "age",
    "speed",
    "width",
    "remaining",
)

RADAR_FEATURE_NAMES = (
    "x",
    "y",
    "angle_sin",
    "angle_cos",
    "clarity",
    "uncertainty",
    "age",
    "remaining",
)


def _finite(value: Any, fallback: float = 0.0) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return fallback
    return number if math.isfinite(number) else fallback


def _ratio(value: Any, maximum: Any) -> float:
    denominator = _finite(maximum)
    if denominator <= 0:
        return 0.0
    return max(0.0, _finite(value) / denominator)


def _flag(value: Any) -> float:
    return 1.0 if bool(value) else 0.0


def _token(value: Any, buckets: int = TOKEN_BUCKETS) -> int:
    if value is None or value == "":
        return 0
    data = str(value).encode("utf-8")
    hashed = 2166136261
    for byte in data:
        hashed ^= byte
        hashed = (hashed * 16777619) & 0xFFFFFFFF
    return 1 + hashed % max(1, buckets - 1)


def _track_token(value: Any) -> int:
    if isinstance(value, int):
        return 1 + (value & 0x7FFFFFFF) % (TOKEN_BUCKETS - 1)
    return _token(value)


def _matrix(
    items: Sequence[Mapping[str, Any]],
    capacity: int,
    width: int,
    extractor: Callable[[Mapping[str, Any]], Sequence[float]],
    *,
    label: str,
    strict_overflow: bool,
) -> tuple[np.ndarray, np.ndarray]:
    if len(items) > capacity and strict_overflow:
        raise OverflowError(f"{label} 实体数量 {len(items)} 超过张量容量 {capacity}")
    array = np.zeros((capacity, width), dtype=np.float32)
    mask = np.zeros((capacity,), dtype=np.bool_)
    for index, item in enumerate(items[:capacity]):
        values = np.asarray(extractor(item), dtype=np.float32)
        if values.shape != (width,):
            raise ValueError(f"{label} 特征宽度错误：期望 {width}，实际 {values.shape}")
        array[index] = values
        mask[index] = True
    return array, mask


def _tokens(
    items: Sequence[Mapping[str, Any]],
    capacity: int,
    fields: Sequence[tuple[str, Callable[[Any], int]]],
) -> np.ndarray:
    result = np.zeros((capacity, len(fields)), dtype=np.int64)
    for row, item in enumerate(items[:capacity]):
        for column, (field, encoder) in enumerate(fields):
            result[row, column] = encoder(item.get(field))
    return result


def _world_scales(observation: Mapping[str, Any]) -> tuple[float, float, float]:
    world = observation.get("world", {})
    width = max(1.0, _finite(world.get("width"), 1440))
    height = max(1.0, _finite(world.get("height"), width))
    elapsed = max(0.0, _finite(world.get("elapsed")))
    return width, height, elapsed


def _own_ship_features(item: Mapping[str, Any], width: float, height: float) -> list[float]:
    angle = _finite(item.get("angle"))
    limits = item.get("limits", {})
    status = item.get("status", {})
    claw = item.get("clawMarks", {})
    route = item.get("route") or {}
    p0 = route.get("p0", {})
    p1 = route.get("p1", {})
    p2 = route.get("p2", {})
    return [
        _flag(item.get("alive")),
        _flag(item.get("flagship")),
        _flag(item.get("auxiliary")),
        _flag(item.get("attached")),
        _flag(item.get("controllable")),
        _finite(item.get("x")) / width,
        _finite(item.get("y")) / height,
        math.sin(angle),
        math.cos(angle),
        _finite(item.get("speed")) / 100,
        _finite(item.get("radius")) / 32,
        _finite(item.get("throttle")) / 1.4,
        _ratio(item.get("hp"), item.get("maxHp")),
        _finite(item.get("maxHp")) / 1200,
        _ratio(item.get("energy"), item.get("maxEnergy")),
        _finite(item.get("maxEnergy")) / 240,
        _ratio(item.get("fleetEnergy"), item.get("fleetMaxEnergy")),
        _finite(item.get("weaponCooldown")) / 5,
        _finite(item.get("skillCooldown")) / 30,
        _finite(item.get("brakeCooldown")) / 3,
        _finite(limits.get("speed")) / 100,
        _finite(limits.get("turnRate")) / 1.5,
        _finite(limits.get("acceleration")) / 3,
        _finite(limits.get("vision")) / 360,
        _finite(limits.get("range")) / 900,
        _finite(limits.get("damage")) / 80,
        _finite(limits.get("fireRate")) / 2,
        _flag(status.get("criticalVolley")),
        _flag(status.get("reliable")),
        _flag(status.get("bladeQueen")),
        _flag(status.get("catPawVolley")),
        _flag(status.get("emergencyBraking")),
        _flag(status.get("nextShotBoosted")),
        _flag(status.get("knockedBack")),
        _ratio(claw.get("stacks"), claw.get("required")),
        _finite(claw.get("expiresIn")) / 10,
        _flag(route),
        _flag(route.get("anchorToMain")),
        _finite(p0.get("x")) / width,
        _finite(p0.get("y")) / height,
        _finite(p1.get("x")) / width,
        _finite(p1.get("y")) / height,
        _finite(p2.get("x")) / width,
        _finite(p2.get("y")) / height,
        _finite(route.get("progress")),
    ]


def _own_aux_features(item: Mapping[str, Any], width: float, height: float) -> list[float]:
    angle = _finite(item.get("angle"))
    return [
        _flag(item.get("alive")),
        _finite(item.get("x")) / width,
        _finite(item.get("y")) / height,
        math.sin(angle),
        math.cos(angle),
        _finite(item.get("speed")) / 140,
        _finite(item.get("radius")) / 16,
        _ratio(item.get("hp"), item.get("maxHp")),
        _finite(item.get("maxHp")) / 200,
        _finite(item.get("vision")) / 360,
        _finite(item.get("life")) / 60,
        _flag(item.get("combatCapable")),
        _finite(item.get("weaponCooldown")) / 5,
    ]


def _opponent_features(item: Mapping[str, Any], width: float, height: float) -> list[float]:
    angle = _finite(item.get("angle"))
    status = item.get("status", {})
    claw = item.get("clawMarks", {})
    return [
        _flag(item.get("alive")),
        _flag(item.get("attached")),
        _flag(item.get("characterConfirmed")),
        _finite(item.get("x")) / width,
        _finite(item.get("y")) / height,
        math.sin(angle),
        math.cos(angle),
        _finite(item.get("speed")) / 100,
        _finite(item.get("radius")) / 32,
        _ratio(item.get("hp"), item.get("maxHp")),
        _finite(item.get("maxHp")) / 1200,
        _ratio(item.get("energy"), item.get("maxEnergy")),
        _finite(item.get("maxEnergy")) / 240,
        _flag(status.get("criticalVolley")),
        _flag(status.get("reliable")),
        _flag(status.get("bladeQueen")),
        _flag(status.get("catPawVolley")),
        _flag(status.get("emergencyBraking")),
        _flag(status.get("nextShotBoosted")),
        _flag(status.get("knockedBack")),
        _ratio(claw.get("stacks"), claw.get("required")),
        _finite(claw.get("expiresIn")) / 10,
    ]


def _encode_one(
    frame: Mapping[str, Any],
    limits: TensorLimits,
    strict_overflow: bool,
) -> dict[str, np.ndarray]:
    observation = frame["observation"]
    action_mask = frame["actionMask"]
    width, height, elapsed = _world_scales(observation)
    own = observation.get("self", {})
    opponents = observation.get("opponent", {}).get("visibleEntities", [])
    effects = observation.get("publicEffects", {})
    radar = observation.get("privateSensors", {}).get("radar") or {}
    own_entities = own.get("entities", [])
    own_ships = [item for item in own_entities if item.get("kind") == "ship"]
    own_aux = [item for item in own_entities if item.get("kind") != "ship"]

    own_ship_values, own_ship_mask = _matrix(
        own_ships,
        limits.own_ships,
        len(OWN_SHIP_FEATURE_NAMES),
        lambda item: _own_ship_features(item, width, height),
        label="己方舰船",
        strict_overflow=strict_overflow,
    )
    own_aux_values, own_aux_mask = _matrix(
        own_aux,
        limits.own_auxiliaries,
        len(OWN_AUX_FEATURE_NAMES),
        lambda item: _own_aux_features(item, width, height),
        label="己方辅助单位",
        strict_overflow=strict_overflow,
    )
    opponent_values, opponent_mask = _matrix(
        opponents,
        limits.opponents,
        len(OPPONENT_FEATURE_NAMES),
        lambda item: _opponent_features(item, width, height),
        label="可见敌方单位",
        strict_overflow=strict_overflow,
    )

    projectiles = effects.get("projectiles", [])
    projectile_values, projectile_mask = _matrix(
        projectiles,
        limits.projectiles,
        len(PROJECTILE_FEATURE_NAMES),
        lambda item: [
            _finite(item.get("x")) / width,
            _finite(item.get("y")) / height,
            _finite(item.get("targetX")) / width,
            _finite(item.get("targetY")) / height,
            _finite(item.get("speed")) / 360,
            _finite(item.get("radius")) / 16,
        ],
        label="公开弹丸",
        strict_overflow=strict_overflow,
    )
    beams = effects.get("beams", [])
    beam_values, beam_mask = _matrix(
        beams,
        limits.beams,
        len(BEAM_FEATURE_NAMES),
        lambda item: [
            _finite(item.get("x1")) / width,
            _finite(item.get("y1")) / height,
            _finite(item.get("x2")) / width,
            _finite(item.get("y2")) / height,
            _finite(item.get("progress")),
            _ratio(item.get("life"), item.get("maxLife")),
        ],
        label="公开光束",
        strict_overflow=strict_overflow,
    )
    waves = effects.get("visionWaves", [])
    wave_values, wave_mask = _matrix(
        waves,
        limits.vision_waves,
        len(VISION_WAVE_FEATURE_NAMES),
        lambda item: [
            _finite(item.get("x")) / width,
            _finite(item.get("y")) / height,
            max(0.0, elapsed - _finite(item.get("emittedAt"))) / 8,
            _finite(item.get("speed")) / 600,
            _finite(item.get("width")) / width,
            max(0.0, _finite(item.get("expiresAt")) - elapsed) / 8,
        ],
        label="公开视野波",
        strict_overflow=strict_overflow,
    )
    contacts = radar.get("contacts", [])
    radar_values, radar_mask = _matrix(
        contacts,
        limits.radar_contacts,
        len(RADAR_FEATURE_NAMES),
        lambda item: [
            _finite(item.get("x")) / width,
            _finite(item.get("y")) / height,
            math.sin(_finite(item.get("angle"))),
            math.cos(_finite(item.get("angle"))),
            _finite(item.get("clarity")),
            _finite(item.get("uncertainty")) / width,
            max(0.0, elapsed - _finite(item.get("detectedAt"))) / 5,
            max(0.0, _finite(item.get("expiresAt")) - elapsed) / 5,
        ],
        label="私有雷达回波",
        strict_overflow=strict_overflow,
    )

    world = observation.get("world", {})
    cooldowns = own.get("cooldowns", {})
    own_effects = own.get("effects", {})
    haruhi = own.get("haruhi") or {}
    radar_angle = _finite(radar.get("angle"))
    global_values = np.asarray(
        [
            width / 1440,
            height / 1440,
            _finite(world.get("padding")) / width,
            elapsed / 180,
            _finite(own.get("splitLevel")) / 2,
            _finite(cooldowns.get("scout")) / 30,
            _finite(cooldowns.get("flagship")) / 30,
            _flag(own.get("skillsDisabled")),
            _flag(own.get("scoutsDisabled")),
            _flag(own_effects.get("accelerationBoost")),
            _flag(own_effects.get("invulnerable")),
            _flag(own_effects.get("sponsor")),
            _flag(own_effects.get("visionWave")),
            _flag(own_effects.get("haruhiBroadcast")),
            _flag(haruhi.get("otherworlderReady")),
            _flag(radar.get("active")),
            math.sin(radar_angle),
            math.cos(radar_angle),
            _finite(radar.get("angularVelocity")) / math.pi,
        ],
        dtype=np.float32,
    )

    support_values = own.get("haruhi", {}).get("supportTokens", []) if own.get("haruhi") else []
    if len(support_values) > limits.supporters and strict_overflow:
        raise OverflowError(f"常驻支援数量 {len(support_values)} 超过张量容量 {limits.supporters}")
    support_tokens = np.zeros((limits.supporters,), dtype=np.int64)
    support_mask = np.zeros((limits.supporters,), dtype=np.bool_)
    for index, value in enumerate(support_values[: limits.supporters]):
        support_tokens[index] = _token(value)
        support_mask[index] = True

    action_by_key = {str(item.get("controlKey")): item for item in action_mask.get("ships", [])}
    nav_mask = np.zeros((limits.own_ships, 3), dtype=np.bool_)
    gear_mask = np.zeros((limits.own_ships, 5), dtype=np.bool_)
    ship_action_flags = np.zeros((limits.own_ships, 3), dtype=np.bool_)
    for index, ship in enumerate(own_ships[: limits.own_ships]):
        mask = action_by_key.get(str(ship.get("controlKey")), {})
        nav_mask[index, : len(mask.get("navigation", []))] = mask.get("navigation", [])[:3]
        gear_mask[index, : len(mask.get("gear", []))] = mask.get("gear", [])[:5]
        ship_action_flags[index] = [
            bool(mask.get("setGear")),
            bool(mask.get("emergencyBrake")),
            bool(mask.get("castSubSkill")),
        ]

    scout_mask = action_mask.get("scout", {})
    source_mask = np.zeros((limits.own_ships,), dtype=np.bool_)
    source_values = scout_mask.get("sourceShips", [])
    source_mask[: min(len(source_values), limits.own_ships)] = source_values[: limits.own_ships]

    return {
        "global": global_values,
        "flagship_token": np.asarray(_token(own.get("flagshipCharacterToken")), dtype=np.int64),
        "future_form_token": np.asarray(_token(own.get("futureFormToken")), dtype=np.int64),
        "support_tokens": support_tokens,
        "support_mask": support_mask,
        "own_ships": own_ship_values,
        "own_ships_mask": own_ship_mask,
        "own_ship_tokens": _tokens(
            own_ships,
            limits.own_ships,
            (("characterToken", _token), ("slotToken", _token), ("id", _track_token)),
        ),
        "own_aux": own_aux_values,
        "own_aux_mask": own_aux_mask,
        "own_aux_tokens": _tokens(
            own_aux,
            limits.own_auxiliaries,
            (("kind", _token), ("id", _track_token)),
        ),
        "opponents": opponent_values,
        "opponents_mask": opponent_mask,
        "opponent_tokens": _tokens(
            opponents,
            limits.opponents,
            (("kind", _token), ("characterToken", _token), ("id", _track_token)),
        ),
        "projectiles": projectile_values,
        "projectiles_mask": projectile_mask,
        "projectile_tokens": _tokens(
            projectiles,
            limits.projectiles,
            (("relation", _token), ("visualToken", _token), ("id", _track_token)),
        ),
        "beams": beam_values,
        "beams_mask": beam_mask,
        "beam_tokens": _tokens(
            beams,
            limits.beams,
            (("relation", _token), ("phaseToken", _token), ("id", _track_token)),
        ),
        "vision_waves": wave_values,
        "vision_waves_mask": wave_mask,
        "vision_wave_tokens": _tokens(
            waves,
            limits.vision_waves,
            (("relation", _token), ("id", _track_token)),
        ),
        "radar": radar_values,
        "radar_mask": radar_mask,
        "radar_tokens": _tokens(
            contacts,
            limits.radar_contacts,
            (("echoToken", _token), ("characterToken", _token), ("contactToken", _track_token)),
        ),
        "action_navigation_mask": nav_mask,
        "action_gear_mask": gear_mask,
        "action_ship_flags": ship_action_flags,
        "action_split_mask": np.asarray(action_mask.get("split", [True, False, False]), dtype=np.bool_),
        "action_scout_launch": np.asarray(bool(scout_mask.get("launch")), dtype=np.bool_),
        "action_scout_source_mask": source_mask,
        "action_scout_zone_mask": np.asarray(scout_mask.get("zones", [True] * 9), dtype=np.bool_),
        "action_flagship": np.asarray(bool(action_mask.get("flagshipSkill")), dtype=np.bool_),
    }


def flatten_seat_frames(results: Iterable[Mapping[str, Any]]) -> list[Mapping[str, Any]]:
    """按每局 A、B 的稳定顺序展开批环境结果。"""

    frames: list[Mapping[str, Any]] = []
    for result in results:
        seats = result["seats"]
        frames.extend((seats["A"], seats["B"]))
    return frames


def encode_frames(
    frames: Sequence[Mapping[str, Any]],
    *,
    limits: TensorLimits = TensorLimits(),
    device: str | torch.device = "cpu",
    strict_overflow: bool = True,
) -> dict[str, torch.Tensor]:
    """编码一批席位帧；张量首维始终是席位样本数。"""

    if not frames:
        raise ValueError("至少需要一个席位观察")
    encoded = [_encode_one(frame, limits, strict_overflow) for frame in frames]
    keys = encoded[0].keys()
    output: dict[str, torch.Tensor] = {}
    for key in keys:
        stacked = np.stack([item[key] for item in encoded], axis=0)
        output[key] = torch.from_numpy(stacked).to(device=device)
    return output
