from __future__ import annotations

import json
import subprocess
import tempfile
from pathlib import Path

from haruhi_rl.bridge import NodeBatchBridge
from haruhi_rl.export import (
    MODEL_INPUT_NAMES,
    MODEL_OUTPUT_NAMES,
    export_onnx_core,
    verify_onnx_core,
)
from haruhi_rl.model import HaruhiUniversalPolicy, PolicyConfig
from haruhi_rl.tensors import TensorLimits, encode_frames, flatten_seat_frames

PROJECT_ROOT = Path(__file__).resolve().parents[2]
DATA_TMP = Path("/Volumes/data/haruhi-rl/tmp")


def test_onnx_core_matches_pytorch_and_has_dynamic_batch() -> None:
    DATA_TMP.mkdir(parents=True, exist_ok=True)
    config = PolicyConfig(model_dim=32, recurrent_dim=64, token_embedding_dim=8)
    limits = TensorLimits(
        own_ships=4,
        own_auxiliaries=16,
        opponents=16,
        projectiles=32,
        beams=8,
        vision_waves=8,
        radar_contacts=8,
    )
    model = HaruhiUniversalPolicy(config)
    with NodeBatchBridge(PROJECT_ROOT, count=2, base_seed=99002) as bridge:
        tensors = encode_frames(flatten_seat_frames(bridge.reset()), limits=limits)
    with tempfile.TemporaryDirectory(prefix="onnx-test-", dir=DATA_TMP) as temporary:
        path = export_onnx_core(model, tensors, Path(temporary) / "policy.onnx")
        with NodeBatchBridge(PROJECT_ROOT, count=1, base_seed=99003) as bridge:
            verification_tensors = encode_frames(flatten_seat_frames(bridge.reset()), limits=limits)
        errors = verify_onnx_core(model, verification_tensors, path)
        assert path.stat().st_size > 0
        assert max(errors.values()) < 2e-4


def test_browser_model_contract_matches_exporter() -> None:
    script = """
      import {
        RL_MODEL_INPUT_NAMES,
        RL_MODEL_OUTPUT_NAMES,
      } from './shared/training/tensors.js';
      console.log(JSON.stringify({ inputs: RL_MODEL_INPUT_NAMES, outputs: RL_MODEL_OUTPUT_NAMES }));
    """
    completed = subprocess.run(
        ["node", "--input-type=module", "--eval", script],
        cwd=PROJECT_ROOT,
        capture_output=True,
        check=False,
        text=True,
        timeout=10,
    )
    assert completed.returncode == 0, completed.stderr
    contract = json.loads(completed.stdout)
    assert contract["inputs"] == list(MODEL_INPUT_NAMES)
    assert contract["outputs"] == list(MODEL_OUTPUT_NAMES)
