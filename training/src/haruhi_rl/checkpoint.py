"""数据盘检查点的原子保存、校验与恢复。"""

from __future__ import annotations

import hashlib
import json
import os
import random
import subprocess
import tempfile
from pathlib import Path
from typing import Any

import numpy as np
import torch

from .resources import ensure_data_disk_path

CHECKPOINT_SCHEMA_VERSION = 1


def _git_commit(project_root: Path) -> str:
    try:
        return subprocess.run(
            ["git", "rev-parse", "HEAD"],
            cwd=project_root,
            check=True,
            capture_output=True,
            text=True,
            timeout=3,
        ).stdout.strip()
    except (FileNotFoundError, subprocess.SubprocessError):
        return "unknown"


def _cpu_copy(value: Any) -> Any:
    if isinstance(value, torch.Tensor):
        return value.detach().cpu()
    if isinstance(value, dict):
        return {key: _cpu_copy(item) for key, item in value.items()}
    if isinstance(value, list):
        return [_cpu_copy(item) for item in value]
    if isinstance(value, tuple):
        return tuple(_cpu_copy(item) for item in value)
    return value


def capture_rng_state(*, include_mps: bool = False) -> dict[str, Any]:
    state: dict[str, Any] = {
        "python": random.getstate(),
        "numpy": np.random.get_state(),
        "torch_cpu": torch.get_rng_state(),
    }
    state["torch_mps"] = None
    if include_mps:
        try:
            state["torch_mps"] = torch.mps.get_rng_state()
        except (AttributeError, RuntimeError):
            pass
    return state


def restore_rng_state(state: dict[str, Any]) -> None:
    random.setstate(state["python"])
    np.random.set_state(state["numpy"])
    torch.set_rng_state(state["torch_cpu"])
    if state.get("torch_mps") is not None:
        try:
            torch.mps.set_rng_state(state["torch_mps"])
        except (AttributeError, RuntimeError):
            pass


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _atomic_json(path: Path, value: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary_name = tempfile.mkstemp(prefix=f".{path.name}.", suffix=".tmp", dir=path.parent)
    temporary = Path(temporary_name)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8") as output:
            json.dump(value, output, ensure_ascii=False, indent=2, sort_keys=True)
            output.flush()
            os.fsync(output.fileno())
        os.replace(temporary, path)
    finally:
        if temporary.exists():
            temporary.unlink()


def save_checkpoint(
    *,
    data_root: str | Path,
    run_name: str,
    update: int,
    model: torch.nn.Module,
    optimizer: torch.optim.Optimizer,
    seed_state: dict[str, Any],
    config: dict[str, Any],
    project_root: str | Path,
    status: str = "running",
    metrics: dict[str, Any] | None = None,
) -> tuple[Path, dict[str, Any]]:
    root = ensure_data_disk_path(data_root)
    safe_run_name = "".join(character for character in run_name if character.isalnum() or character in "-_")
    if not safe_run_name:
        raise ValueError("训练运行名称无效")
    directory = root / "checkpoints" / safe_run_name
    directory.mkdir(parents=True, exist_ok=True)
    target = directory / f"update_{int(update):06d}.pt"
    payload = {
        "schema_version": CHECKPOINT_SCHEMA_VERSION,
        "run_name": safe_run_name,
        "update": int(update),
        "status": str(status),
        "git_commit": _git_commit(Path(project_root).resolve()),
        "model": _cpu_copy(model.state_dict()),
        "optimizer": _cpu_copy(optimizer.state_dict()),
        "seed_state": seed_state,
        "rng_state": capture_rng_state(
            include_mps=any(parameter.device.type == "mps" for parameter in model.parameters()),
        ),
        "config": config,
        "metrics": metrics or {},
    }

    descriptor, temporary_name = tempfile.mkstemp(prefix=f".{target.name}.", suffix=".tmp", dir=directory)
    os.close(descriptor)
    temporary = Path(temporary_name)
    try:
        torch.save(payload, temporary)
        with temporary.open("rb") as source:
            os.fsync(source.fileno())
        os.replace(temporary, target)
    finally:
        if temporary.exists():
            temporary.unlink()

    digest = _sha256(target)
    manifest = {
        "schema_version": CHECKPOINT_SCHEMA_VERSION,
        "run_name": safe_run_name,
        "update": int(update),
        "status": str(status),
        "path": str(target),
        "sha256": digest,
        "git_commit": payload["git_commit"],
        "metrics": metrics or {},
    }
    _atomic_json(directory / "latest.json", manifest)
    return target, manifest


def load_checkpoint(
    path: str | Path,
    *,
    expected_sha256: str | None = None,
) -> dict[str, Any]:
    checkpoint = ensure_data_disk_path(path)
    if expected_sha256 and _sha256(checkpoint) != expected_sha256:
        raise ValueError("检查点 SHA-256 校验失败")
    payload = torch.load(checkpoint, map_location="cpu", weights_only=False)
    if int(payload.get("schema_version", 0)) != CHECKPOINT_SCHEMA_VERSION:
        raise ValueError("检查点版本不兼容")
    return payload


def move_optimizer_state(optimizer: torch.optim.Optimizer, device: torch.device) -> None:
    for state in optimizer.state.values():
        for key, value in state.items():
            if isinstance(value, torch.Tensor):
                state[key] = value.to(device=device)
