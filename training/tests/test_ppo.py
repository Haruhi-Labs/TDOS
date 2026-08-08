from __future__ import annotations

from pathlib import Path

import torch

from haruhi_rl.bridge import NodeBatchBridge
from haruhi_rl.model import HaruhiUniversalPolicy, PolicyConfig
from haruhi_rl.ppo import PpoConfig, RecurrentPpoTrainer
from haruhi_rl.rollout import RolloutBatch, SelfPlayCollector, concatenate_rollout_batches
from haruhi_rl.seeds import EpisodeSeedScheduler, mix_episode_seed

PROJECT_ROOT = Path(__file__).resolve().parents[2]


def test_seed_scheduler_resumes_without_repeating() -> None:
    scheduler = EpisodeSeedScheduler(base_seed=55001, stream_count=2)
    first = [scheduler.next_seed(0), scheduler.next_seed(1), scheduler.next_seed(0)]
    restored = EpisodeSeedScheduler.from_state_dict(scheduler.state_dict())
    assert restored.next_seed(0) == scheduler.next_seed(0)
    assert restored.next_seed(1) == scheduler.next_seed(1)
    assert len(set(first)) == len(first)
    assert mix_episode_seed(1, 2, 3) == mix_episode_seed(1, 2, 3)


def test_collect_and_recurrent_ppo_update() -> None:
    torch.manual_seed(19)
    model = HaruhiUniversalPolicy(PolicyConfig(model_dim=32, recurrent_dim=64, token_embedding_dim=8))
    scheduler = EpisodeSeedScheduler(base_seed=55002, stream_count=2)
    with NodeBatchBridge(
        PROJECT_ROOT,
        count=2,
        base_seed=55002,
        decision_ticks=3,
        max_episode_seconds=30,
    ) as bridge:
        collector = SelfPlayCollector(bridge, model, scheduler)
        rollout = collector.collect(steps=4)

    assert rollout.rewards.shape == (4, 4)
    assert rollout.dones.shape == (4, 4)
    assert torch.all(rollout.valid)
    assert rollout.hidden.shape == (4, 4, 64)
    assert rollout.advantages is not None
    assert rollout.returns is not None
    assert torch.count_nonzero(rollout.rewards) == 0
    assert torch.isfinite(rollout.old_log_prob).all()

    before = {key: value.detach().clone() for key, value in model.state_dict().items()}
    trainer = RecurrentPpoTrainer(
        model,
        PpoConfig(
            epochs=1,
            sequence_length=2,
            minibatch_sequences=4,
            target_kl=10,
        ),
    )
    metrics = trainer.update(rollout)
    assert metrics["updates"] > 0
    assert all(torch.isfinite(torch.tensor(value)) for value in metrics.values())
    assert any(not torch.equal(before[key], value) for key, value in model.state_dict().items())


def test_timeout_terminal_return_stays_outcome_only() -> None:
    torch.manual_seed(20)
    model = HaruhiUniversalPolicy(PolicyConfig(model_dim=32, recurrent_dim=64, token_embedding_dim=8))
    scheduler = EpisodeSeedScheduler(base_seed=55003, stream_count=1)
    with NodeBatchBridge(
        PROJECT_ROOT,
        count=1,
        base_seed=55003,
        decision_ticks=3,
        max_episode_seconds=0.1,
    ) as bridge:
        collector = SelfPlayCollector(bridge, model, scheduler)
        rollout = collector.collect(steps=2)
    assert torch.allclose(rollout.rewards, torch.full_like(rollout.rewards, -0.02))
    assert torch.all(rollout.dones)
    assert len(rollout.completed_episodes) == 2
    assert all(item["truncated"] for item in rollout.completed_episodes)


def test_complete_episode_collection_masks_filler_games() -> None:
    torch.manual_seed(21)
    model = HaruhiUniversalPolicy(PolicyConfig(model_dim=32, recurrent_dim=64, token_embedding_dim=8))
    scheduler = EpisodeSeedScheduler(base_seed=55004, stream_count=2)
    with NodeBatchBridge(
        PROJECT_ROOT,
        count=2,
        base_seed=55004,
        decision_ticks=3,
        max_episode_seconds=0.2,
    ) as bridge:
        collector = SelfPlayCollector(bridge, model, scheduler)
        rollout = collector.collect_complete_episodes(maximum_steps=4)
    assert len(rollout.completed_episodes) == 2
    assert rollout.steps <= 4
    assert torch.all(rollout.valid.any(dim=0))
    assert torch.all(rollout.rewards[~rollout.valid] == 0)
    original_steps = rollout.steps
    rollout.pad_to_multiple(3)
    assert rollout.steps % 3 == 0
    assert torch.all(~rollout.valid[original_steps:])


def test_complete_collection_calls_progress_guard() -> None:
    torch.manual_seed(22)
    model = HaruhiUniversalPolicy(PolicyConfig(model_dim=32, recurrent_dim=64, token_embedding_dim=8))
    scheduler = EpisodeSeedScheduler(base_seed=55005, stream_count=1)
    calls: list[int] = []
    with NodeBatchBridge(
        PROJECT_ROOT,
        count=1,
        base_seed=55005,
        decision_ticks=3,
        max_episode_seconds=0.3,
    ) as bridge:
        collector = SelfPlayCollector(bridge, model, scheduler)
        collector.collect_complete_episodes(
            maximum_steps=5,
            progress_hook=calls.append,
            progress_interval=1,
        )
    assert calls
    assert calls == sorted(calls)


def test_complete_rollout_batches_merge_on_sample_axis() -> None:
    def batch(steps: int, samples: int, marker: float) -> RolloutBatch:
        shape = (steps, samples)
        return RolloutBatch(
            observations={"global": torch.full((*shape, 2), marker)},
            actions={"split": torch.zeros(shape, dtype=torch.long)},
            old_log_prob=torch.zeros(shape),
            old_value=torch.zeros(shape),
            rewards=torch.zeros(shape),
            dones=torch.zeros(shape, dtype=torch.bool),
            valid=torch.ones(shape, dtype=torch.bool),
            episode_starts=torch.zeros(shape, dtype=torch.bool),
            hidden=torch.zeros((*shape, 4)),
            bootstrap_value=torch.zeros(samples),
            completed_episodes=({"marker": marker},),
        )

    first = batch(3, 2, 1)
    second = batch(5, 1, 2)
    combined = concatenate_rollout_batches([first, second])
    assert combined.steps == 5
    assert combined.samples == 3
    assert torch.all(combined.valid[:3, :2])
    assert torch.all(~combined.valid[3:, :2])
    assert torch.all(combined.dones[3:, :2])
    assert torch.all(combined.episode_starts[3:, :2])
    assert torch.all(combined.observations["global"][:3, :2] == 1)
    assert torch.all(combined.observations["global"][:, 2:] == 2)
    assert combined.advantages is not None
    assert len(combined.completed_episodes) == 2
