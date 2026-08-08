"""从训练检查点生成 ONNX 与部署元数据。"""

from __future__ import annotations

import argparse
import json
from dataclasses import asdict
from pathlib import Path

from .bridge import NodeBatchBridge
from .checkpoint import load_checkpoint
from .export import (
    MODEL_INPUT_NAMES,
    MODEL_OUTPUT_NAMES,
    export_onnx_core,
    file_sha256,
    verify_onnx_core,
    write_export_metadata,
)
from .model import HaruhiUniversalPolicy, PolicyConfig
from .resources import ensure_data_disk_path
from .tensors import TENSOR_SCHEMA_VERSION, TensorLimits, encode_frames, flatten_seat_frames


def main() -> int:
    parser = argparse.ArgumentParser(description="导出通用策略 ONNX 核心")
    parser.add_argument("--checkpoint", required=True)
    args = parser.parse_args()
    project_root = Path.cwd().resolve()
    payload = load_checkpoint(args.checkpoint)
    config = payload.get("config")
    if not isinstance(config, dict):
        raise ValueError("检查点缺少可复现导出所需的训练配置")
    model_config = PolicyConfig(**config.get("model", {}))
    model = HaruhiUniversalPolicy(model_config)
    model.load_state_dict(payload["model"])
    limits = TensorLimits(**config.get("tensor_limits", {}))
    with NodeBatchBridge(project_root, count=1, base_seed=99001) as bridge:
        tensors = encode_frames(flatten_seat_frames(bridge.reset()), limits=limits)

    data_root = ensure_data_disk_path(config["run"].get("data_root", "/Volumes/data/haruhi-rl"))
    run_name = str(payload.get("run_name") or config["run"]["name"])
    directory = data_root / "models" / run_name / f"update_{int(payload['update']):06d}"
    model_path = export_onnx_core(model, tensors, directory / "policy-core.onnx")
    errors = verify_onnx_core(model, tensors, model_path)
    metadata = {
        "schema_version": 1,
        "checkpoint": str(Path(args.checkpoint).resolve()),
        "checkpoint_update": int(payload["update"]),
        "git_commit": payload.get("git_commit", "unknown"),
        "onnx_opset": 18,
        "onnx_sha256": file_sha256(model_path),
        "onnx_bytes": model_path.stat().st_size,
        "model_config": asdict(model_config),
        "tensor_limits": asdict(limits),
        "observation_schema_version": 1,
        "action_schema_version": 2,
        "tensor_schema_version": TENSOR_SCHEMA_VERSION,
        "inputs": list(MODEL_INPUT_NAMES),
        "outputs": list(MODEL_OUTPUT_NAMES),
        "maximum_verification_error": max(errors.values(), default=0),
    }
    metadata_path = write_export_metadata(directory / "metadata.json", metadata)
    print(json.dumps({
        "model": str(model_path),
        "metadata": str(metadata_path),
        "bytes": metadata["onnx_bytes"],
        "sha256": metadata["onnx_sha256"],
        "maximum_error": metadata["maximum_verification_error"],
    }, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
