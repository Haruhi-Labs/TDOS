"""检查点对 master AI 的正式评测命令。"""

from __future__ import annotations

import argparse
import json
import os
import tempfile
from pathlib import Path

import torch

from .checkpoint import load_checkpoint
from .evaluation import (
    assess_candidate,
    cross_loadout_benchmark_cases,
    evaluate_cases,
    mirror_benchmark_cases,
    summarize_results,
)
from .model import HaruhiUniversalPolicy, PolicyConfig
from .resources import ensure_data_disk_path
from .tensors import TensorLimits


def _atomic_json(path: Path, value: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, name = tempfile.mkstemp(prefix=f".{path.name}.", suffix=".tmp", dir=path.parent)
    temporary = Path(name)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8") as output:
            json.dump(value, output, ensure_ascii=False, indent=2, sort_keys=True)
            output.flush()
            os.fsync(output.fileno())
        os.replace(temporary, path)
    finally:
        if temporary.exists():
            temporary.unlink()


def main() -> int:
    parser = argparse.ArgumentParser(description="评测通用策略检查点")
    parser.add_argument("--checkpoint", required=True)
    parser.add_argument("--repeats", type=int, default=4)
    parser.add_argument("--batch-size", type=int, default=8)
    parser.add_argument("--device", default="auto")
    args = parser.parse_args()
    project_root = Path.cwd().resolve()
    payload = load_checkpoint(args.checkpoint)
    config = payload.get("config")
    if not isinstance(config, dict):
        raise ValueError("检查点缺少可复现评测所需的训练配置")
    model_config = PolicyConfig(**config.get("model", {}))
    model = HaruhiUniversalPolicy(model_config)
    model.load_state_dict(payload["model"])
    device = torch.device(
        "mps" if args.device == "auto" and torch.backends.mps.is_available()
        else "cpu" if args.device == "auto"
        else args.device,
    )
    limits = TensorLimits(**config.get("tensor_limits", {}))
    cases = [
        *mirror_benchmark_cases(base_seed=88000, repeats=args.repeats),
        *cross_loadout_benchmark_cases(base_seed=188000, repeats=args.repeats),
    ]
    results = []
    for offset in range(0, len(cases), args.batch_size):
        results.extend(evaluate_cases(
            project_root,
            model,
            cases[offset : offset + args.batch_size],
            device=device,
            tensor_limits=limits,
        ))
    report = {
        "checkpoint": str(Path(args.checkpoint).resolve()),
        "checkpoint_update": int(payload["update"]),
        "summary": summarize_results(results),
        "assessment": assess_candidate(results),
    }
    data_root = ensure_data_disk_path(config["run"].get("data_root", "/Volumes/data/haruhi-rl"))
    run_name = str(payload.get("run_name") or config["run"]["name"])
    output = data_root / "runs" / run_name / "evaluations" / f"update_{int(payload['update']):06d}.json"
    _atomic_json(output, report)
    print(json.dumps({"output": str(output), **report["assessment"]}, ensure_ascii=False))
    return 0 if report["assessment"]["status"] == "proven_not_worse" else 2


if __name__ == "__main__":
    raise SystemExit(main())
