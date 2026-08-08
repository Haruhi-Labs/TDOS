from __future__ import annotations

import json
from pathlib import Path
import subprocess

import pytest
import torch

from haruhi_rl.bridge import NodeBatchBridge
from haruhi_rl.distributions import actions_to_seat_payloads, sample_policy
from haruhi_rl.model import HaruhiUniversalPolicy, PolicyConfig
from haruhi_rl.tensors import TensorLimits, encode_frames, flatten_seat_frames

PROJECT_ROOT = Path(__file__).resolve().parents[2]


def _serialized(tensors: dict[str, torch.Tensor]) -> dict[str, dict]:
    return {
        name: {
            "dims": list(value.shape),
            "data": value.detach().cpu().flatten().tolist(),
        }
        for name, value in tensors.items()
    }


def _assert_payload_close(actual: object, expected: object, path: str = "root") -> None:
    if isinstance(expected, dict):
        assert isinstance(actual, dict), path
        assert actual.keys() == expected.keys(), path
        for key, value in expected.items():
            _assert_payload_close(actual[key], value, f"{path}.{key}")
    elif isinstance(expected, list):
        assert isinstance(actual, list), path
        assert len(actual) == len(expected), path
        for index, value in enumerate(expected):
            _assert_payload_close(actual[index], value, f"{path}[{index}]")
    elif isinstance(expected, float):
        assert actual == pytest.approx(expected, abs=1e-7), path
    else:
        assert actual == expected, path


def test_browser_deterministic_decoder_matches_python() -> None:
    torch.manual_seed(88001)
    limits = TensorLimits(
        own_ships=4,
        own_auxiliaries=8,
        opponents=8,
        projectiles=16,
        beams=4,
        vision_waves=4,
        radar_contacts=4,
    )
    with NodeBatchBridge(PROJECT_ROOT, count=2, base_seed=88002) as bridge:
        frames = flatten_seat_frames(bridge.reset())
    tensors = encode_frames(frames, limits=limits)
    model = HaruhiUniversalPolicy(PolicyConfig(model_dim=32, recurrent_dim=64, token_embedding_dim=8))
    with torch.no_grad():
        outputs = model.forward_step(tensors)
        sample = sample_policy(outputs, tensors, deterministic=True)
    expected = actions_to_seat_payloads(sample.actions, tensors["own_ships_mask"])
    completed = subprocess.run(
        ["node", "training/js/decode-policy.mjs"],
        cwd=PROJECT_ROOT,
        input=json.dumps({"outputs": _serialized(outputs), "tensors": _serialized(tensors)}),
        capture_output=True,
        check=False,
        text=True,
        timeout=20,
    )
    assert completed.returncode == 0, completed.stderr
    _assert_payload_close(json.loads(completed.stdout), expected)
