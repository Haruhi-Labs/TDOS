from __future__ import annotations

from pathlib import Path

from haruhi_rl.evaluation import evaluate_cases, mirror_benchmark_cases, summarize_results
from haruhi_rl.model import HaruhiUniversalPolicy, PolicyConfig

PROJECT_ROOT = Path(__file__).resolve().parents[2]


def test_mirror_suite_balances_seats_and_main_characters() -> None:
    cases = mirror_benchmark_cases(base_seed=77001, repeats=1)
    assert len(cases) == 16
    assert sum(case.learner_seat == "A" for case in cases) == 8
    assert sum(case.learner_seat == "B" for case in cases) == 8
    assert len({case.learner_loadout["main"] for case in cases}) == 8
    assert all(case.learner_loadout == case.bot_loadout for case in cases)


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
