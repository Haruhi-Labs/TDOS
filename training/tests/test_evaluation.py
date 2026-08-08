from __future__ import annotations

from pathlib import Path

from haruhi_rl.evaluation import (
    BenchmarkResult,
    assess_candidate,
    cross_loadout_benchmark_cases,
    evaluate_cases,
    mirror_benchmark_cases,
    summarize_results,
)
from haruhi_rl.model import HaruhiUniversalPolicy, PolicyConfig

PROJECT_ROOT = Path(__file__).resolve().parents[2]


def test_mirror_suite_balances_seats_and_main_characters() -> None:
    cases = mirror_benchmark_cases(base_seed=77001, repeats=1)
    assert len(cases) == 16
    assert sum(case.learner_seat == "A" for case in cases) == 8
    assert sum(case.learner_seat == "B" for case in cases) == 8
    assert len({case.learner_loadout["main"] for case in cases}) == 8
    assert all(case.learner_loadout == case.bot_loadout for case in cases)
    cross = cross_loadout_benchmark_cases(base_seed=77101, repeats=1)
    assert len(cross) == 16
    assert all(case.learner_loadout != case.bot_loadout for case in cross)


def test_candidate_evaluation_uses_master_benchmark_path() -> None:
    config = PolicyConfig(model_dim=32, recurrent_dim=64, token_embedding_dim=8)
    model = HaruhiUniversalPolicy(config)
    cases = mirror_benchmark_cases(base_seed=77002, repeats=1)[:2]
    results = evaluate_cases(
        PROJECT_ROOT,
        model,
        cases,
        max_episode_seconds=0.2,
        maximum_steps=4,
    )
    summary = summarize_results(results)
    assert summary["games"] == 2
    assert summary["timeout_rate"] == 1
    assert set(summary["by_seat"]) == {"A", "B"}


def synthetic_results(score: float, *, games: int = 128) -> list[BenchmarkResult]:
    results = []
    wins = round(score * games)
    for index in range(games):
        seat = "A" if index % 2 == 0 else "B"
        main = mirror_benchmark_cases(base_seed=1, repeats=1)[index % 16].learner_loadout
        won = index < wins
        results.append(BenchmarkResult(
            seed=index,
            learner_seat=seat,
            learner_loadout=main,
            bot_loadout=dict(main),
            reward=1 if won else -1,
            winner_seat=seat if won else ("B" if seat == "A" else "A"),
            elapsed=100,
            terminated=True,
            truncated=False,
        ))
    return results


def test_candidate_gate_distinguishes_candidate_and_proven() -> None:
    weak = assess_candidate(synthetic_results(0.48))
    assert weak["status"] == "insufficient_or_rejected"
    strong = assess_candidate(synthetic_results(0.68, games=256))
    assert strong["status"] == "proven_not_worse"
