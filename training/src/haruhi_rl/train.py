"""通用策略第一阶段：完整局、纯终局回报的共享策略自我博弈。"""

from __future__ import annotations

import argparse
import gc
import json
import random
import sys
import time
from dataclasses import asdict
from pathlib import Path
from typing import Any

import numpy as np
import torch
import yaml
from torch.utils.tensorboard import SummaryWriter

from .bridge import NodeBatchBridge
from .checkpoint import (
    load_checkpoint,
    move_optimizer_state,
    restore_rng_state,
    save_checkpoint,
)
from .league import LeagueRegistry
from .league_rollout import LeagueSelfPlayCollector
from .model import HaruhiUniversalPolicy, PolicyConfig
from .ppo import PpoConfig, RecurrentPpoTrainer
from .resources import GIB, evaluate_resource_safety, read_resource_snapshot
from .rollout import SelfPlayCollector, concatenate_rollout_batches
from .run_status import RunStatusWriter
from .seeds import EpisodeSeedScheduler
from .tensors import TensorLimits


class TrainingResourcePause(RuntimeError):
    def __init__(self, reasons: tuple[str, ...]) -> None:
        super().__init__("；".join(reasons))
        self.reasons = reasons


def _read_config(path: Path) -> dict[str, Any]:
    with path.open("r", encoding="utf-8") as source:
        config = yaml.safe_load(source)
    if not isinstance(config, dict):
        raise ValueError("训练配置必须是对象")
    return config


def _device(name: str) -> torch.device:
    if name == "auto":
        return torch.device("mps" if torch.backends.mps.is_available() else "cpu")
    device = torch.device(name)
    if device.type == "mps" and not torch.backends.mps.is_available():
        raise RuntimeError("配置要求 MPS，但当前 PyTorch 无法使用 MPS")
    return device


def _append_jsonl(path: Path, value: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as output:
        output.write(json.dumps(value, ensure_ascii=False, sort_keys=True) + "\n")
        output.flush()


def _episode_metrics(episodes: tuple[dict[str, Any], ...]) -> dict[str, float]:
    count = len(episodes)
    if not count:
        return {
            "episodes": 0,
            "natural_completion_rate": 0,
            "average_seconds": 0,
            "seat_a_win_rate": 0,
        }
    return {
        "episodes": float(count),
        "natural_completion_rate": sum(not item["truncated"] for item in episodes) / count,
        "average_seconds": sum(float(item["elapsed"]) for item in episodes) / count,
        "seat_a_win_rate": sum(item["winnerSeat"] == "A" for item in episodes) / count,
    }


def _seed_everything(seed: int) -> None:
    random.seed(seed)
    np.random.seed(seed & 0xFFFFFFFF)
    torch.manual_seed(seed)


def _resource_details(snapshot: Any) -> dict[str, float | None]:
    return {
        "system_free_gib": snapshot.system_free_bytes / GIB,
        "data_free_gib": snapshot.data_free_bytes / GIB,
        "swap_free_gib": None if snapshot.swap_free_bytes is None else snapshot.swap_free_bytes / GIB,
        "memory_free_percent": snapshot.memory_free_percent,
        "process_rss_gib": snapshot.process_rss_bytes / GIB,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="训练《射手座之日》通用全控制策略")
    parser.add_argument("--config", default="training/configs/universal-v0.yaml")
    parser.add_argument("--resume")
    args = parser.parse_args()
    project_root = Path.cwd().resolve()
    config = _read_config((project_root / args.config).resolve())
    run_config = config["run"]
    environment_config = config["environment"]
    data_root = Path(run_config.get("data_root", "/Volumes/data/haruhi-rl"))

    safety = evaluate_resource_safety(read_resource_snapshot(data_root))
    if not safety.allowed:
        for reason in safety.reasons:
            print(f"训练未启动：{reason}", file=sys.stderr)
        return 75

    seed = int(run_config["seed"])
    _seed_everything(seed)
    device = _device(str(run_config.get("device", "auto")))
    model_config = PolicyConfig(**config.get("model", {}))
    ppo_config = PpoConfig(**config.get("ppo", {}))
    tensor_limits = TensorLimits(**config.get("tensor_limits", {}))
    model = HaruhiUniversalPolicy(model_config)
    trainer = RecurrentPpoTrainer(model, ppo_config, device=device)
    scheduler = EpisodeSeedScheduler(
        base_seed=seed,
        stream_count=int(environment_config["count"]),
        stream_offset=int(environment_config.get("stream_offset", 0)),
    )
    start_update = 0
    run_name = str(run_config["name"])
    registry = LeagueRegistry(data_root, run_name, seed=seed)
    if args.resume:
        payload = load_checkpoint(args.resume)
        if payload["config"] != config:
            raise ValueError("续训配置与检查点配置不一致")
        model.load_state_dict(payload["model"])
        trainer.optimizer.load_state_dict(payload["optimizer"])
        move_optimizer_state(trainer.optimizer, device)
        scheduler = EpisodeSeedScheduler.from_state_dict(payload["seed_state"])
        restore_rng_state(payload["rng_state"])
        start_update = int(payload["update"])

    run_directory = data_root / "runs" / run_name
    metrics_path = run_directory / "metrics.jsonl"
    status_writer = RunStatusWriter(data_root, run_name)
    status_writer.write(state="running", phase="initializing", update=start_update)
    writer = SummaryWriter(log_dir=str(run_directory / "tensorboard"))
    last_metrics: dict[str, Any] = {}
    bridge = NodeBatchBridge(
        project_root,
        count=int(environment_config["count"]),
        base_seed=seed,
        decision_ticks=int(environment_config.get("decision_ticks", 3)),
        max_episode_seconds=float(environment_config.get("max_episode_seconds", 180)),
        stream_offset=int(environment_config.get("stream_offset", 0)),
    )
    collector = SelfPlayCollector(
        bridge,
        model,
        scheduler,
        device=device,
        tensor_limits=tensor_limits,
    )

    current_update = start_update
    try:
        for update in range(start_update + 1, int(run_config["updates"]) + 1):
            current_update = update
            current_resources = read_resource_snapshot(data_root)
            decision = evaluate_resource_safety(current_resources)
            if not decision.allowed:
                path, _ = save_checkpoint(
                    data_root=data_root,
                    run_name=run_name,
                    update=update - 1,
                    model=model,
                    optimizer=trainer.optimizer,
                    seed_state=scheduler.state_dict(),
                    config=config,
                    project_root=project_root,
                    status="paused_resource_guard",
                    metrics={**last_metrics, "pause_reasons": list(decision.reasons)},
                )
                status_writer.write(
                    state="paused_resource_guard",
                    phase="before_collection",
                    update=update - 1,
                    details={
                        "checkpoint": str(path),
                        "reasons": list(decision.reasons),
                        **_resource_details(current_resources),
                    },
                )
                print(f"资源保护已暂停训练，检查点：{path}", file=sys.stderr)
                return 75

            training_mode = (
                "league"
                if registry.entries and update > int(config.get("league", {}).get("warmup_updates", 1))
                else "live_self_play"
            )
            collection_rounds = max(1, int(environment_config.get("rounds_per_update", 1)))
            status_writer.write(
                state="running",
                phase="collecting",
                update=update,
                phase_step=0,
                details={
                    "training_mode": training_mode,
                    "collection_rounds": collection_rounds,
                    **_resource_details(current_resources),
                },
            )
            last_heartbeat_at = time.monotonic()

            def progress_guard(step: int) -> None:
                nonlocal last_heartbeat_at
                progress_resources = read_resource_snapshot(data_root)
                progress_decision = evaluate_resource_safety(progress_resources)
                if not progress_decision.allowed:
                    raise TrainingResourcePause(progress_decision.reasons)
                now = time.monotonic()
                if now - last_heartbeat_at >= 5:
                    status_writer.write(
                        state="running",
                        phase="collecting",
                        update=update,
                        phase_step=step,
                        details={
                            "training_mode": training_mode,
                            "collection_rounds": collection_rounds,
                            **_resource_details(progress_resources),
                        },
                    )
                    last_heartbeat_at = now

            collected = []
            try:
                maximum_steps = int(environment_config["maximum_collection_steps"])
                if training_mode == "league":
                    league_collector = LeagueSelfPlayCollector(
                        bridge,
                        model,
                        model_config,
                        scheduler,
                        registry,
                        device=device,
                        tensor_limits=tensor_limits,
                    )
                    round_collector = league_collector.collect_complete_episodes
                else:
                    round_collector = collector.collect_complete_episodes
                for round_index in range(collection_rounds):
                    rollout_round = round_collector(
                        maximum_steps=maximum_steps,
                        progress_hook=lambda step, offset=round_index * maximum_steps: progress_guard(
                            offset + step,
                        ),
                    )
                    collected.append(rollout_round)
                rollout = concatenate_rollout_batches(collected)
                collected.clear()
                del rollout_round
                gc.collect()
            except TrainingResourcePause as pause:
                collected.clear()
                if "rollout_round" in locals():
                    del rollout_round
                gc.collect()
                if device.type == "mps":
                    torch.mps.empty_cache()
                path, _ = save_checkpoint(
                    data_root=data_root,
                    run_name=run_name,
                    update=update - 1,
                    model=model,
                    optimizer=trainer.optimizer,
                    seed_state=scheduler.state_dict(),
                    config=config,
                    project_root=project_root,
                    status="paused_resource_guard",
                    metrics={**last_metrics, "pause_reasons": list(pause.reasons)},
                )
                status_writer.write(
                    state="paused_resource_guard",
                    phase="collection",
                    update=update - 1,
                    details={"checkpoint": str(path), "reasons": list(pause.reasons)},
                )
                print(f"采集期间资源保护已暂停训练，检查点：{path}", file=sys.stderr)
                return 75
            episode_metrics = _episode_metrics(rollout.completed_episodes)
            for episode in rollout.completed_episodes:
                if episode.get("opponentId"):
                    registry.record_result(
                        str(episode["opponentId"]),
                        float(episode["learnerScore"]),
                    )
            status_writer.write(
                state="running",
                phase="optimizing",
                update=update,
                details={"training_mode": training_mode, **episode_metrics},
            )
            training_metrics = trainer.update(rollout)
            after_update_resources = read_resource_snapshot(data_root)
            after_update_decision = evaluate_resource_safety(after_update_resources)
            if not after_update_decision.allowed:
                del rollout
                gc.collect()
                if device.type == "mps":
                    torch.mps.empty_cache()
                registry.save()
                path, _ = save_checkpoint(
                    data_root=data_root,
                    run_name=run_name,
                    update=update,
                    model=model,
                    optimizer=trainer.optimizer,
                    seed_state=scheduler.state_dict(),
                    config=config,
                    project_root=project_root,
                    status="paused_resource_guard",
                    metrics={
                        **last_metrics,
                        **episode_metrics,
                        **training_metrics,
                        "pause_reasons": list(after_update_decision.reasons),
                    },
                )
                status_writer.write(
                    state="paused_resource_guard",
                    phase="after_optimization",
                    update=update,
                    details={
                        "checkpoint": str(path),
                        "reasons": list(after_update_decision.reasons),
                        **_resource_details(after_update_resources),
                    },
                )
                print(f"更新后资源保护已暂停训练，检查点：{path}", file=sys.stderr)
                return 75
            last_metrics = {
                "update": update,
                "device": str(device),
                "training_mode": training_mode,
                "valid_seat_steps": int(rollout.valid.sum()),
                "league_size": len(registry.entries),
                "league_rating": registry.current_rating,
                **episode_metrics,
                **training_metrics,
                "system_free_gib": current_resources.system_free_bytes / GIB,
                "data_free_gib": current_resources.data_free_bytes / GIB,
                "swap_free_gib": None if current_resources.swap_free_bytes is None else current_resources.swap_free_bytes / GIB,
            }
            _append_jsonl(metrics_path, last_metrics)
            for key, value in last_metrics.items():
                if isinstance(value, (int, float)):
                    writer.add_scalar(key, value, update)
            writer.flush()

            if update % int(run_config.get("checkpoint_every", 1)) == 0:
                _, manifest = save_checkpoint(
                    data_root=data_root,
                    run_name=run_name,
                    update=update,
                    model=model,
                    optimizer=trainer.optimizer,
                    seed_state=scheduler.state_dict(),
                    config=config,
                    project_root=project_root,
                    status="running",
                    metrics=last_metrics,
                )
                league_config = config.get("league", {})
                snapshot_every = int(league_config.get("snapshot_every", 5))
                warmup_updates = int(league_config.get("warmup_updates", 1))
                if update == warmup_updates or update % snapshot_every == 0:
                    registry.register_checkpoint(manifest)
                else:
                    registry.save()
            status_writer.write(
                state="running",
                phase="update_complete",
                update=update,
                details=last_metrics,
            )
            del rollout
            gc.collect()
            if device.type == "mps":
                torch.mps.empty_cache()

        completed_path, _ = save_checkpoint(
            data_root=data_root,
            run_name=run_name,
            update=int(run_config["updates"]),
            model=model,
            optimizer=trainer.optimizer,
            seed_state=scheduler.state_dict(),
            config=config,
            project_root=project_root,
            status="completed",
            metrics=last_metrics,
        )
        status_writer.write(
            state="completed",
            phase="completed",
            update=int(run_config["updates"]),
            details={"checkpoint": str(completed_path), **last_metrics},
        )
    except KeyboardInterrupt:
        status_writer.write(
            state="interrupted",
            phase="interrupted",
            update=current_update,
        )
        raise
    except Exception as error:
        status_writer.write(
            state="failed",
            phase="exception",
            update=current_update,
            details={"error_type": type(error).__name__, "error": str(error)},
        )
        raise
    finally:
        bridge.close()
        writer.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
