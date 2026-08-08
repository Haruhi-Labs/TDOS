from __future__ import annotations

from copy import deepcopy
from pathlib import Path

import pytest
import torch

from haruhi_rl.bridge import NodeBatchBridge
from haruhi_rl.tensors import (
    GLOBAL_FEATURE_NAMES,
    OPPONENT_FEATURE_NAMES,
    OWN_AUX_FEATURE_NAMES,
    OWN_SHIP_FEATURE_NAMES,
    PROJECTILE_FEATURE_NAMES,
    RADAR_FEATURE_NAMES,
    TensorLimits,
    encode_frames,
    flatten_seat_frames,
)

PROJECT_ROOT = Path(__file__).resolve().parents[2]


def reset_frames(count: int = 2) -> list[dict]:
    with NodeBatchBridge(PROJECT_ROOT, count=count, base_seed=33001) as bridge:
        return flatten_seat_frames(bridge.reset())


def test_tensor_shapes_and_dtypes() -> None:
    frames = reset_frames(2)
    limits = TensorLimits()
    tensors = encode_frames(frames, limits=limits)
    batch = 4
    assert tensors["global"].shape == (batch, len(GLOBAL_FEATURE_NAMES))
    assert tensors["own_ships"].shape == (batch, limits.own_ships, len(OWN_SHIP_FEATURE_NAMES))
    assert tensors["own_aux"].shape == (batch, limits.own_auxiliaries, len(OWN_AUX_FEATURE_NAMES))
    assert tensors["opponents"].shape == (batch, limits.opponents, len(OPPONENT_FEATURE_NAMES))
    assert tensors["projectiles"].shape == (batch, limits.projectiles, len(PROJECTILE_FEATURE_NAMES))
    assert tensors["radar"].shape == (batch, limits.radar_contacts, len(RADAR_FEATURE_NAMES))
    assert tensors["action_navigation_mask"].shape == (batch, limits.own_ships, 3)
    assert tensors["action_gear_mask"].shape == (batch, limits.own_ships, 5)
    assert tensors["own_ships"].dtype == torch.float32
    assert tensors["own_ship_tokens"].dtype == torch.int64
    assert tensors["own_ships_mask"].dtype == torch.bool
    assert torch.all(tensors["own_ships_mask"].sum(dim=1) == 3)
    assert torch.all(tensors["action_navigation_mask"][:, 0, 0])


def test_hidden_enemies_remain_padding() -> None:
    frames = reset_frames(1)
    tensors = encode_frames(frames)
    assert not torch.any(tensors["opponents_mask"])
    assert torch.count_nonzero(tensors["opponents"]) == 0
    assert torch.count_nonzero(tensors["opponent_tokens"]) == 0


def test_entity_tokens_are_opaque_and_stable() -> None:
    frames = reset_frames(1)
    first = encode_frames(frames)
    second = encode_frames(deepcopy(frames))
    assert torch.equal(first["own_ship_tokens"], second["own_ship_tokens"])
    assert torch.all(first["own_ship_tokens"][:, :3, 0] > 0)


def test_overflow_is_never_silent() -> None:
    frames = reset_frames(1)
    tiny = TensorLimits(own_ships=2)
    with pytest.raises(OverflowError, match="己方舰船"):
        encode_frames(frames, limits=tiny)


def test_mask_alignment_follows_control_key() -> None:
    frames = reset_frames(1)
    tensors = encode_frames(frames)
    navigation = tensors["action_navigation_mask"]
    assert torch.all(navigation[:, 0, 1])
    assert not torch.any(navigation[:, 1:3, 1])
