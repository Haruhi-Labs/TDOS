from __future__ import annotations

from copy import deepcopy
import json
from pathlib import Path
import subprocess

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
    assert tensors["action_ship_flags"].shape == (batch, limits.own_ships, 5)
    assert tensors["action_flagship_parameters"].shape == (batch, 2)
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


def test_browser_encoder_matches_python_element_by_element() -> None:
    frames = reset_frames(2)
    sample = frames[0]
    own_ship = sample["observation"]["self"]["entities"][0]
    own_ship.update({
        "status": {
            "criticalVolley": True,
            "reliable": True,
            "bladeQueen": True,
            "catPawVolley": True,
            "emergencyBraking": True,
            "nextShotBoosted": True,
            "knockedBack": True,
        },
        "clawMarks": {"stacks": 3, "required": 5, "expiresIn": 4.25},
        "route": {
            "anchorToMain": False,
            "p0": {"x": 120, "y": 240},
            "p1": {"x": 360, "y": 480},
            "p2": {"x": 600, "y": 720},
            "progress": 0.35,
        },
    })
    sample["observation"]["self"]["haruhi"] = {
        "supportTokens": ["alien", "esper"],
        "otherworlderReady": True,
    }
    sample["observation"]["self"]["entities"].append({
        "id": 991,
        "kind": "wingman",
        "alive": True,
        "x": 512,
        "y": 384,
        "angle": 1.2,
        "speed": 88,
        "radius": 7,
        "hp": 42,
        "maxHp": 80,
        "vision": 280,
        "life": 24,
        "combatCapable": True,
        "weaponCooldown": 0.75,
    })
    sample["observation"]["opponent"]["visibleEntities"] = [{
        "id": "enemy-main",
        "kind": "ship",
        "characterToken": "nagato",
        "characterConfirmed": True,
        "alive": True,
        "attached": False,
        "x": 1100,
        "y": 840,
        "angle": -0.45,
        "speed": 57,
        "radius": 22,
        "hp": 630,
        "maxHp": 900,
        "energy": 78,
        "maxEnergy": 180,
        "status": {"reliable": True, "knockedBack": True},
        "clawMarks": {"stacks": 4, "required": 5, "expiresIn": 6},
    }]
    sample["observation"]["publicEffects"] = {
        "projectiles": [{
            "id": 201,
            "relation": "opponent",
            "visualToken": "cat-paw",
            "x": 800,
            "y": 700,
            "targetX": 400,
            "targetY": 300,
            "speed": 250,
            "radius": 5,
        }],
        "beams": [{
            "id": "beam-1",
            "relation": "self",
            "phaseToken": "charge",
            "x1": 200,
            "y1": 300,
            "x2": 1200,
            "y2": 1000,
            "progress": 0.6,
            "life": 0.8,
            "maxLife": 1.5,
        }],
        "visionWaves": [{
            "id": 301,
            "relation": "opponent",
            "x": 720,
            "y": 720,
            "emittedAt": 1,
            "speed": 180,
            "width": 64,
            "expiresAt": 8,
        }],
    }
    sample["observation"]["privateSensors"]["radar"] = {
        "active": True,
        "angle": 2.4,
        "angularVelocity": 0.25,
        "contacts": [{
            "contactToken": "echo-17",
            "echoToken": "fleet-shadow",
            "characterToken": "asakura",
            "x": 960,
            "y": 440,
            "angle": 0.8,
            "clarity": 0.65,
            "uncertainty": 45,
            "detectedAt": 0.25,
            "expiresAt": 4.75,
        }],
    }
    limits = TensorLimits(
        own_ships=4,
        own_auxiliaries=16,
        opponents=16,
        projectiles=32,
        beams=8,
        vision_waves=8,
        radar_contacts=8,
    )
    expected = encode_frames(frames, limits=limits)
    completed = subprocess.run(
        ["node", "training/js/encode-tensors.mjs"],
        cwd=PROJECT_ROOT,
        input=json.dumps({"frames": frames, "limits": limits.__dict__}),
        capture_output=True,
        check=False,
        text=True,
        timeout=20,
    )
    assert completed.returncode == 0, completed.stderr
    actual = json.loads(completed.stdout)
    assert actual.keys() == expected.keys()
    for name, tensor in expected.items():
        assert actual[name]["dims"] == list(tensor.shape), name
        candidate = torch.tensor(actual[name]["data"], dtype=tensor.dtype).reshape(tensor.shape)
        if tensor.dtype == torch.float32:
            assert torch.allclose(candidate, tensor, rtol=1e-6, atol=1e-7), name
        else:
            assert torch.equal(candidate, tensor), name
