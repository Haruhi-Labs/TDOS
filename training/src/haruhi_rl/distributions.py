"""混合离散/连续全控制动作的采样与对数概率计算。"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Mapping

import torch
from torch.distributions import Categorical, Normal


@dataclass
class PolicySample:
    actions: dict[str, torch.Tensor]
    log_prob: torch.Tensor
    entropy: torch.Tensor
    value: torch.Tensor
    hidden: torch.Tensor


def _safe_mask(mask: torch.Tensor) -> torch.Tensor:
    mask = mask.bool()
    any_valid = mask.any(dim=-1, keepdim=True)
    fallback = torch.zeros_like(mask)
    fallback[..., 0] = True
    return torch.where(any_valid, mask, fallback)


def _categorical(logits: torch.Tensor, mask: torch.Tensor) -> Categorical:
    safe = _safe_mask(mask)
    return Categorical(logits=logits.masked_fill(~safe, -1e9))


def _binary(logits: torch.Tensor, true_allowed: torch.Tensor) -> Categorical:
    mask = torch.stack((torch.ones_like(true_allowed, dtype=torch.bool), true_allowed.bool()), dim=-1)
    return _categorical(logits, mask)


def _select(distribution: Categorical, deterministic: bool, supplied: torch.Tensor | None) -> torch.Tensor:
    if supplied is not None:
        return supplied.long()
    if deterministic:
        return distribution.logits.argmax(dim=-1)
    return distribution.sample()


def _squashed_normal(
    mean: torch.Tensor,
    log_std: torch.Tensor,
    deterministic: bool,
    supplied: torch.Tensor | None,
) -> tuple[torch.Tensor, torch.Tensor, torch.Tensor]:
    log_std = log_std.clamp(-3, 1)
    distribution = Normal(mean, log_std.exp())
    if supplied is None:
        pre_tanh = mean if deterministic else distribution.rsample()
        action = torch.tanh(pre_tanh)
    else:
        action = supplied.clamp(-0.999999, 0.999999)
        pre_tanh = torch.atanh(action)
    log_prob = distribution.log_prob(pre_tanh) - torch.log(1 - action.square() + 1e-6)
    entropy = distribution.entropy()
    return action, log_prob, entropy


def _weighted_sum(values: torch.Tensor, active: torch.Tensor) -> torch.Tensor:
    while active.ndim < values.ndim:
        active = active.unsqueeze(-1)
    return (values * active.to(values.dtype)).flatten(start_dim=1).sum(dim=1)


def sample_policy(
    output: Mapping[str, torch.Tensor],
    tensors: Mapping[str, torch.Tensor],
    *,
    deterministic: bool = False,
    actions: Mapping[str, torch.Tensor] | None = None,
) -> PolicySample:
    supplied = actions or {}
    real_ships = tensors["own_ships_mask"].bool()
    ship_flags = tensors["action_ship_flags"].bool()

    nav_dist = _categorical(output["ship_navigation_logits"], tensors["action_navigation_mask"])
    navigation = _select(nav_dist, deterministic, supplied.get("ship_navigation"))
    route_active = real_ships & navigation.eq(1)

    set_gear_dist = _binary(output["ship_set_gear_logits"], ship_flags[..., 0])
    set_gear = _select(set_gear_dist, deterministic, supplied.get("ship_set_gear"))
    set_gear_active = real_ships & ship_flags[..., 0] & ~route_active

    gear_dist = _categorical(output["ship_gear_logits"], tensors["action_gear_mask"])
    gear = _select(gear_dist, deterministic, supplied.get("ship_gear"))
    gear_active = route_active | (set_gear_active & set_gear.bool())

    brake_dist = _binary(output["ship_brake_logits"], ship_flags[..., 1])
    brake = _select(brake_dist, deterministic, supplied.get("ship_brake"))
    brake_active = real_ships & ship_flags[..., 1]

    subskill_dist = _binary(output["ship_subskill_logits"], ship_flags[..., 2])
    subskill = _select(subskill_dist, deterministic, supplied.get("ship_subskill"))
    subskill_active = real_ships & ship_flags[..., 2]

    subzone_dist = _categorical(
        output["ship_subzone_logits"],
        torch.ones_like(output["ship_subzone_logits"], dtype=torch.bool),
    )
    subzone = _select(subzone_dist, deterministic, supplied.get("ship_subzone"))
    subzone_active = subskill_active & subskill.bool() & ship_flags[..., 4]

    ship_continuous, ship_continuous_log_prob, ship_continuous_entropy = _squashed_normal(
        output["ship_continuous_mean"],
        output["ship_continuous_log_std"],
        deterministic,
        supplied.get("ship_continuous"),
    )
    route_continuous_active = route_active.unsqueeze(-1).expand(-1, -1, 4)
    skill_continuous_active = (
        subskill_active & subskill.bool() & ship_flags[..., 3]
    ).unsqueeze(-1).expand(-1, -1, 2)
    ship_continuous_active = torch.cat((route_continuous_active, skill_continuous_active), dim=-1)

    split_dist = _categorical(output["split_logits"], tensors["action_split_mask"])
    split = _select(split_dist, deterministic, supplied.get("split"))

    scout_launch_dist = _binary(output["scout_launch_logits"], tensors["action_scout_launch"])
    scout_launch = _select(scout_launch_dist, deterministic, supplied.get("scout_launch"))
    scout_source_dist = _categorical(output["scout_source_logits"], tensors["action_scout_source_mask"])
    scout_source = _select(scout_source_dist, deterministic, supplied.get("scout_source"))
    scout_zone_dist = _categorical(output["scout_zone_logits"], tensors["action_scout_zone_mask"])
    scout_zone = _select(scout_zone_dist, deterministic, supplied.get("scout_zone"))
    scout_parameter_active = scout_launch.bool() & tensors["action_scout_launch"].bool()

    flagship_dist = _binary(output["flagship_logits"], tensors["action_flagship"])
    flagship_cast = _select(flagship_dist, deterministic, supplied.get("flagship_cast"))
    flagship_zone_dist = _categorical(
        output["flagship_zone_logits"],
        torch.ones_like(output["flagship_zone_logits"], dtype=torch.bool),
    )
    flagship_zone = _select(flagship_zone_dist, deterministic, supplied.get("flagship_zone"))
    flagship_parameters = tensors["action_flagship_parameters"].bool()
    flagship_zone_active = flagship_cast.bool() & tensors["action_flagship"].bool() & flagship_parameters[..., 1]
    flagship_continuous, flagship_continuous_log_prob, flagship_continuous_entropy = _squashed_normal(
        output["flagship_continuous_mean"],
        output["flagship_continuous_log_std"],
        deterministic,
        supplied.get("flagship_continuous"),
    )
    flagship_continuous_active = (
        flagship_cast.bool() & tensors["action_flagship"].bool() & flagship_parameters[..., 0]
    ).unsqueeze(-1).expand(-1, 2)

    log_prob = (
        _weighted_sum(nav_dist.log_prob(navigation), real_ships)
        + _weighted_sum(set_gear_dist.log_prob(set_gear), set_gear_active)
        + _weighted_sum(gear_dist.log_prob(gear), gear_active)
        + _weighted_sum(brake_dist.log_prob(brake), brake_active)
        + _weighted_sum(subskill_dist.log_prob(subskill), subskill_active)
        + _weighted_sum(subzone_dist.log_prob(subzone), subzone_active)
        + _weighted_sum(ship_continuous_log_prob, ship_continuous_active)
        + split_dist.log_prob(split)
        + scout_launch_dist.log_prob(scout_launch)
        + scout_source_dist.log_prob(scout_source) * scout_parameter_active
        + scout_zone_dist.log_prob(scout_zone) * scout_parameter_active
        + flagship_dist.log_prob(flagship_cast)
        + flagship_zone_dist.log_prob(flagship_zone) * flagship_zone_active
        + _weighted_sum(flagship_continuous_log_prob, flagship_continuous_active)
    )
    entropy = (
        _weighted_sum(nav_dist.entropy(), real_ships)
        + _weighted_sum(set_gear_dist.entropy(), set_gear_active)
        + _weighted_sum(gear_dist.entropy(), gear_active)
        + _weighted_sum(brake_dist.entropy(), brake_active)
        + _weighted_sum(subskill_dist.entropy(), subskill_active)
        + _weighted_sum(subzone_dist.entropy(), subzone_active)
        + _weighted_sum(ship_continuous_entropy, ship_continuous_active)
        + split_dist.entropy()
        + scout_launch_dist.entropy()
        + scout_source_dist.entropy() * scout_parameter_active
        + scout_zone_dist.entropy() * scout_parameter_active
        + flagship_dist.entropy()
        + flagship_zone_dist.entropy() * flagship_zone_active
        + _weighted_sum(flagship_continuous_entropy, flagship_continuous_active)
    )

    return PolicySample(
        actions={
            "ship_navigation": navigation,
            "ship_set_gear": set_gear,
            "ship_gear": gear,
            "ship_brake": brake,
            "ship_subskill": subskill,
            "ship_subzone": subzone,
            "ship_continuous": ship_continuous,
            "split": split,
            "scout_launch": scout_launch,
            "scout_source": scout_source,
            "scout_zone": scout_zone,
            "flagship_cast": flagship_cast,
            "flagship_zone": flagship_zone,
            "flagship_continuous": flagship_continuous,
        },
        log_prob=log_prob,
        entropy=entropy,
        value=output["value"],
        hidden=output["hidden"],
    )


def actions_to_seat_payloads(
    actions: Mapping[str, torch.Tensor],
    own_ships_mask: torch.Tensor,
) -> list[dict[str, object]]:
    """把席位动作张量还原为通用 Node 策略动作 JSON。"""

    cpu = {key: value.detach().cpu() for key, value in actions.items()}
    mask = own_ships_mask.detach().cpu()
    sample_count = mask.shape[0]
    seats: list[dict[str, object]] = []
    for sample in range(sample_count):
        ships: list[dict[str, object]] = []
        for ship in range(int(mask[sample].sum().item())):
            continuous = cpu["ship_continuous"][sample, ship]
            ships.append({
                "navigation": int(cpu["ship_navigation"][sample, ship]),
                "setGear": bool(cpu["ship_set_gear"][sample, ship]),
                "gear": int(cpu["ship_gear"][sample, ship]),
                "end": {"x": float(continuous[0]), "y": float(continuous[1])},
                "control": {"x": float(continuous[2]), "y": float(continuous[3])},
                "emergencyBrake": bool(cpu["ship_brake"][sample, ship]),
                "castSubSkill": bool(cpu["ship_subskill"][sample, ship]),
                "skillZone": int(cpu["ship_subzone"][sample, ship]) + 1,
                "skillTarget": {"x": float(continuous[4]), "y": float(continuous[5])},
            })
        seats.append({
            "ships": ships,
            "split": int(cpu["split"][sample]),
            "scout": {
                "launch": bool(cpu["scout_launch"][sample]),
                "sourceShip": int(cpu["scout_source"][sample]),
                "zone": int(cpu["scout_zone"][sample]) + 1,
            },
            "flagshipSkill": {
                "cast": bool(cpu["flagship_cast"][sample]),
                "zone": int(cpu["flagship_zone"][sample]) + 1,
                "target": {
                    "x": float(cpu["flagship_continuous"][sample, 0]),
                    "y": float(cpu["flagship_continuous"][sample, 1]),
                },
            },
        })

    return seats


def actions_to_environment_payloads(
    actions: Mapping[str, torch.Tensor],
    own_ships_mask: torch.Tensor,
) -> list[dict[str, dict[str, object]]]:
    """把按 A、B 展开的席位动作还原为训练批环境 JSON。"""

    seats = actions_to_seat_payloads(actions, own_ships_mask)
    if len(seats) % 2:
        raise ValueError("席位样本数必须是 2 的倍数，才能还原为 A/B 对局")
    return [
        {"A": seats[index], "B": seats[index + 1]}
        for index in range(0, len(seats), 2)
    ]
