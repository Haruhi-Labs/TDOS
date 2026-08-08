"""候选通用策略对当前 master 规则 AI 的换边镜像评测。"""

from __future__ import annotations

from dataclasses import asdict, dataclass
import math
from pathlib import Path
from typing import Any, Sequence

import torch

from .bridge import NodeBatchBridge
from .checkpoint import load_checkpoint
from .distributions import actions_to_seat_payloads, sample_policy
from .model import HaruhiUniversalPolicy, PolicyConfig
from .rollout import _to_device
from .tensors import TensorLimits, encode_frames

CHARACTER_TOKENS = (
    "haruhi",
    "koizumi",
    "yuki",
    "future1096",
    "kyon",
    "tsuruya",
    "asakura",
    "shamisen",
)


@dataclass(frozen=True)
class BenchmarkCase:
    seed: int
    learner_seat: str
    learner_loadout: dict[str, str]
    bot_loadout: dict[str, str]

    def node_options(self) -> dict[str, Any]:
        return {
            "seed": self.seed,
            "learnerSeat": self.learner_seat,
            "learnerLoadout": self.learner_loadout,
            "botLoadout": self.bot_loadout,
            "mirrorLoadout": False,
        }


@dataclass(frozen=True)
class BenchmarkResult:
    seed: int
    learner_seat: str
    learner_loadout: dict[str, str]
    bot_loadout: dict[str, str]
    reward: float
    winner_seat: str | None
    elapsed: float
    terminated: bool
    truncated: bool


def mirror_benchmark_cases(*, base_seed: int, repeats: int = 2) -> list[BenchmarkCase]:
    cases: list[BenchmarkCase] = []
    sequence = 0
    for repeat in range(repeats):
        for index, main in enumerate(CHARACTER_TOKENS):
            loadout = {
                "main": main,
                "sub1": CHARACTER_TOKENS[(index + 1 + repeat) % len(CHARACTER_TOKENS)],
                "sub2": CHARACTER_TOKENS[(index + 3 + repeat) % len(CHARACTER_TOKENS)],
            }
            for seat in ("A", "B"):
                cases.append(BenchmarkCase(
                    seed=base_seed + sequence,
                    learner_seat=seat,
                    learner_loadout=loadout,
                    bot_loadout=dict(loadout),
                ))
                sequence += 1
    return cases


def cross_loadout_benchmark_cases(*, base_seed: int, repeats: int = 2) -> list[BenchmarkCase]:
    cases: list[BenchmarkCase] = []
    sequence = 0
    size = len(CHARACTER_TOKENS)
    for repeat in range(repeats):
        for index, main in enumerate(CHARACTER_TOKENS):
            learner = {
                "main": main,
                "sub1": CHARACTER_TOKENS[(index + 2 + repeat) % size],
                "sub2": CHARACTER_TOKENS[(index + 5 + repeat) % size],
            }
            bot = {
                "main": CHARACTER_TOKENS[(index + 4 + repeat) % size],
                "sub1": CHARACTER_TOKENS[(index + 6 + repeat) % size],
                "sub2": CHARACTER_TOKENS[(index + 7 + repeat) % size],
            }
            for seat in ("A", "B"):
                cases.append(BenchmarkCase(
                    seed=base_seed + sequence,
                    learner_seat=seat,
                    learner_loadout=learner,
                    bot_loadout=bot,
                ))
                sequence += 1
    return cases


@torch.no_grad()
def evaluate_cases(
    project_root: str | Path,
    model: HaruhiUniversalPolicy,
    cases: Sequence[BenchmarkCase],
    *,
    device: torch.device | str = "cpu",
    decision_ticks: int = 3,
    max_episode_seconds: float = 180,
    maximum_steps: int = 1802,
    tensor_limits: TensorLimits = TensorLimits(),
) -> list[BenchmarkResult]:
    if not cases:
        return []
    device = torch.device(device)
    model.to(device).eval()
    with NodeBatchBridge(
        project_root,
        count=len(cases),
        base_seed=cases[0].seed,
        decision_ticks=decision_ticks,
        max_episode_seconds=max_episode_seconds,
        kind="benchmark",
    ) as bridge:
        frames = bridge.reset([case.node_options() for case in cases])
        seat_frames = [frame["seat"] for frame in frames]
        hidden = model.initial_hidden(len(cases), device=device)
        episode_start = torch.ones(len(cases), dtype=torch.bool, device=device)
        active = torch.ones(len(cases), dtype=torch.bool)
        results: list[BenchmarkResult | None] = [None] * len(cases)
        for step in range(maximum_steps):
            encoded_cpu = encode_frames(seat_frames, limits=tensor_limits)
            encoded = _to_device(encoded_cpu, device)
            output = model.forward_step(encoded, hidden, episode_start=episode_start)
            sample = sample_policy(output, encoded, deterministic=True)
            payloads = actions_to_seat_payloads(sample.actions, encoded["own_ships_mask"])
            next_frames = bridge.step(payloads)
            reset_flags = torch.zeros(len(cases), dtype=torch.bool)
            for index, frame in enumerate(next_frames):
                done = bool(frame["terminated"] or frame["truncated"])
                if active[index] and done:
                    case = cases[index]
                    results[index] = BenchmarkResult(
                        seed=case.seed,
                        learner_seat=case.learner_seat,
                        learner_loadout=case.learner_loadout,
                        bot_loadout=case.bot_loadout,
                        reward=float(frame["reward"]),
                        winner_seat=frame["info"]["winnerSeat"],
                        elapsed=float(frame["info"]["elapsed"]),
                        terminated=bool(frame["terminated"]),
                        truncated=bool(frame["truncated"]),
                    )
                    active[index] = False
                if done:
                    filler_case = cases[index]
                    filler = bridge.reset_at(index, {
                        "seed": filler_case.seed + 10_000_000 + step,
                        "learnerSeat": filler_case.learner_seat,
                        "learnerLoadout": filler_case.learner_loadout,
                        "botLoadout": filler_case.bot_loadout,
                        "mirrorLoadout": False,
                    })
                    next_frames[index] = filler
                    reset_flags[index] = True
            seat_frames = [frame["seat"] for frame in next_frames]
            hidden = sample.hidden
            episode_start = reset_flags.to(device)
            if not torch.any(active):
                break
        if torch.any(active):
            raise RuntimeError(f"以下评测局未在步数上限内结束：{torch.nonzero(active).flatten().tolist()}")
    return [result for result in results if result is not None]


def summarize_results(results: Sequence[BenchmarkResult]) -> dict[str, Any]:
    count = len(results)
    wins = sum(result.reward > 0 for result in results)
    draws = sum(result.reward == 0 for result in results)
    timeouts = sum(result.truncated for result in results)
    by_main: dict[str, dict[str, int]] = {}
    by_seat: dict[str, dict[str, int]] = {}
    for result in results:
        main = result.learner_loadout["main"]
        main_row = by_main.setdefault(main, {"games": 0, "wins": 0})
        seat_row = by_seat.setdefault(result.learner_seat, {"games": 0, "wins": 0})
        main_row["games"] += 1
        main_row["wins"] += int(result.reward > 0)
        seat_row["games"] += 1
        seat_row["wins"] += int(result.reward > 0)
    return {
        "games": count,
        "wins": wins,
        "draws": draws,
        "losses": count - wins - draws,
        "win_rate": wins / count if count else 0,
        "timeout_rate": timeouts / count if count else 0,
        "average_seconds": sum(result.elapsed for result in results) / count if count else 0,
        "by_main": by_main,
        "by_seat": by_seat,
        "results": [asdict(result) for result in results],
    }


def _evaluation_score(result: BenchmarkResult) -> float:
    if result.truncated:
        return 0.0
    if result.winner_seat is None:
        return 0.5
    return 1.0 if result.reward > 0 else 0.0


def _wilson_interval(successes: float, count: int, z: float = 1.959963984540054) -> tuple[float, float]:
    if count <= 0:
        return 0.0, 1.0
    proportion = successes / count
    denominator = 1 + z * z / count
    center = (proportion + z * z / (2 * count)) / denominator
    margin = z * math.sqrt(
        proportion * (1 - proportion) / count + z * z / (4 * count * count),
    ) / denominator
    return max(0.0, center - margin), min(1.0, center + margin)


def assess_candidate(results: Sequence[BenchmarkResult]) -> dict[str, Any]:
    """以 5% 非劣界筛选候选；95% 下界达到 50% 才标记为已证明不弱于 master。"""

    count = len(results)
    scores = [_evaluation_score(result) for result in results]
    total_score = sum(scores)
    score_rate = total_score / count if count else 0
    lower, upper = _wilson_interval(total_score, count)
    timeout_rate = sum(result.truncated for result in results) / count if count else 1

    seat_scores = {
        seat: [score for result, score in zip(results, scores, strict=True) if result.learner_seat == seat]
        for seat in ("A", "B")
    }
    seat_rates = {
        seat: sum(values) / len(values) if values else 0
        for seat, values in seat_scores.items()
    }
    main_rates: dict[str, float] = {}
    for character in CHARACTER_TOKENS:
        values = [
            score
            for result, score in zip(results, scores, strict=True)
            if result.learner_loadout["main"] == character
        ]
        main_rates[character] = sum(values) / len(values) if values else 0

    checks = {
        "enough_games": count >= 128,
        "point_estimate_not_below_master": score_rate >= 0.5,
        "noninferiority_lower_bound": lower >= 0.45,
        "proven_lower_bound": lower >= 0.5,
        "timeout_rate": timeout_rate <= 0.05,
        "seat_gap": abs(seat_rates["A"] - seat_rates["B"]) <= 0.1,
        "all_main_roles": all(rate >= 0.35 for rate in main_rates.values()),
    }
    candidate_checks = [
        "enough_games",
        "point_estimate_not_below_master",
        "noninferiority_lower_bound",
        "timeout_rate",
        "seat_gap",
        "all_main_roles",
    ]
    candidate = all(checks[key] for key in candidate_checks)
    proven = candidate and checks["proven_lower_bound"]
    status = "proven_not_worse" if proven else "candidate" if candidate else "insufficient_or_rejected"
    return {
        "status": status,
        "games": count,
        "score_rate": score_rate,
        "score_interval_95": [lower, upper],
        "timeout_rate": timeout_rate,
        "seat_rates": seat_rates,
        "main_rates": main_rates,
        "checks": checks,
    }


def load_candidate(path: str | Path, config: PolicyConfig) -> HaruhiUniversalPolicy:
    payload = load_checkpoint(path)
    model = HaruhiUniversalPolicy(config)
    model.load_state_dict(payload["model"])
    return model
