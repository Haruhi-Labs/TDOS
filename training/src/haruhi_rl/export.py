"""将公平循环策略核心导出为浏览器可加载的 ONNX。"""

from __future__ import annotations

import hashlib
import json
import os
import tempfile
from pathlib import Path
from typing import Mapping

import numpy as np
import onnx
import onnxruntime as ort
import torch
from torch import nn

from .model import HaruhiUniversalPolicy

MODEL_INPUT_NAMES = (
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
    "hidden",
    "episode_start",
)

MODEL_OUTPUT_NAMES = (
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
)

_OUTPUT_KEYS = (
    "hidden",
    "value",
    *MODEL_OUTPUT_NAMES[2:],
)


class OnnxPolicyCore(nn.Module):
    def __init__(self, model: HaruhiUniversalPolicy) -> None:
        super().__init__()
        self.model = model

    def forward(self, *inputs: torch.Tensor) -> tuple[torch.Tensor, ...]:
        mapped = dict(zip(MODEL_INPUT_NAMES, inputs, strict=True))
        hidden = mapped.pop("hidden")
        episode_start = mapped.pop("episode_start")
        output = self.model.forward_step(mapped, hidden, episode_start=episode_start)
        return tuple(output[key] for key in _OUTPUT_KEYS)


def model_inputs(
    tensors: Mapping[str, torch.Tensor],
    hidden: torch.Tensor,
    episode_start: torch.Tensor,
) -> tuple[torch.Tensor, ...]:
    values = {**tensors, "hidden": hidden, "episode_start": episode_start}
    return tuple(values[name].detach().cpu() for name in MODEL_INPUT_NAMES)


def export_onnx_core(
    model: HaruhiUniversalPolicy,
    tensors: Mapping[str, torch.Tensor],
    output_path: str | Path,
    *,
    opset: int = 18,
) -> Path:
    target = Path(output_path).resolve()
    target.parent.mkdir(parents=True, exist_ok=True)
    model = model.cpu().eval()
    batch = tensors["global"].shape[0]
    hidden = model.initial_hidden(batch, device="cpu")
    episode_start = torch.ones(batch, dtype=torch.bool)
    inputs = model_inputs(tensors, hidden, episode_start)
    wrapper = OnnxPolicyCore(model).eval()
    dynamic_axes = {
        name: {0: "batch"}
        for name in (*MODEL_INPUT_NAMES, *MODEL_OUTPUT_NAMES)
    }
    descriptor, name = tempfile.mkstemp(prefix=f".{target.name}.", suffix=".tmp", dir=target.parent)
    os.close(descriptor)
    temporary = Path(name)
    try:
        torch.onnx.export(
            wrapper,
            inputs,
            temporary,
            export_params=True,
            opset_version=opset,
            do_constant_folding=True,
            input_names=list(MODEL_INPUT_NAMES),
            output_names=list(MODEL_OUTPUT_NAMES),
            dynamic_axes=dynamic_axes,
            dynamo=False,
        )
        graph = onnx.load(temporary)
        onnx.checker.check_model(graph)
        os.replace(temporary, target)
    finally:
        if temporary.exists():
            temporary.unlink()
    return target


def verify_onnx_core(
    model: HaruhiUniversalPolicy,
    tensors: Mapping[str, torch.Tensor],
    path: str | Path,
) -> dict[str, float]:
    model = model.cpu().eval()
    batch = tensors["global"].shape[0]
    hidden = model.initial_hidden(batch, device="cpu")
    episode_start = torch.ones(batch, dtype=torch.bool)
    inputs = model_inputs(tensors, hidden, episode_start)
    wrapper = OnnxPolicyCore(model).eval()
    with torch.no_grad():
        expected = wrapper(*inputs)
    session = ort.InferenceSession(str(path), providers=["CPUExecutionProvider"])
    actual = session.run(
        list(MODEL_OUTPUT_NAMES),
        {name: value.numpy() for name, value in zip(MODEL_INPUT_NAMES, inputs, strict=True)},
    )
    errors = {
        name: float(np.max(np.abs(reference.detach().numpy() - candidate)))
        for name, reference, candidate in zip(MODEL_OUTPUT_NAMES, expected, actual, strict=True)
    }
    if max(errors.values(), default=0) > 2e-4:
        raise ValueError(f"ONNX 与 PyTorch 输出偏差过大：{errors}")
    return errors


def file_sha256(path: str | Path) -> str:
    digest = hashlib.sha256()
    with Path(path).open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def write_export_metadata(path: str | Path, metadata: dict) -> Path:
    target = Path(path).resolve()
    target.parent.mkdir(parents=True, exist_ok=True)
    descriptor, name = tempfile.mkstemp(prefix=f".{target.name}.", suffix=".tmp", dir=target.parent)
    temporary = Path(name)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8") as output:
            json.dump(metadata, output, ensure_ascii=False, indent=2, sort_keys=True)
            output.flush()
            os.fsync(output.fileno())
        os.replace(temporary, target)
    finally:
        if temporary.exists():
            temporary.unlink()
    return target
