from __future__ import annotations

import tempfile
from pathlib import Path

import torch

from haruhi_rl.bridge import NodeBatchBridge
from haruhi_rl.checkpoint import save_checkpoint
from haruhi_rl.league import LeagueRegistry
from haruhi_rl.league_rollout import LeagueSelfPlayCollector
from haruhi_rl.model import HaruhiUniversalPolicy, PolicyConfig
from haruhi_rl.seeds import EpisodeSeedScheduler

PROJECT_ROOT = Path(__file__).resolve().parents[2]
DATA_TMP = Path("/Volumes/data/haruhi-rl/tmp")


def historical_manifest(root: Path, model: HaruhiUniversalPolicy) -> dict:
    optimizer = torch.optim.Adam(model.parameters(), lr=1e-3)
    _, manifest = save_checkpoint(
        data_root=root,
        run_name="league-test",
        update=1,
        model=model,
        optimizer=optimizer,
        seed_state={"base_seed": 1, "stream_count": 2, "stream_offset": 0, "counters": [1, 1]},
        config={"test": True},
        project_root=PROJECT_ROOT,
        status="test",
    )
    return manifest


def test_league_registry_sampling_and_rating_are_reproducible() -> None:
    DATA_TMP.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="league-registry-", dir=DATA_TMP) as temporary:
        root = Path(temporary)
        model = HaruhiUniversalPolicy(PolicyConfig(model_dim=32, recurrent_dim=64, token_embedding_dim=8))
        manifest = historical_manifest(root, model)
        first = LeagueRegistry(root, "test", seed=66001)
        entry = first.register_checkpoint(manifest)
        state = first.state_dict()
        restored = LeagueRegistry(root, "test", seed=0, state=state)
        assert first.learner_seat() == restored.learner_seat()
        assert first.sample_opponent().entry_id == restored.sample_opponent().entry_id
        before = restored.current_rating
        restored.record_result(entry.entry_id, 1)
        assert restored.current_rating > before
        assert restored.entries[0].learner_wins == 1


def test_historical_policy_collects_only_learner_seats() -> None:
    torch.manual_seed(31)
    DATA_TMP.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="league-rollout-", dir=DATA_TMP) as temporary:
        root = Path(temporary)
        config = PolicyConfig(model_dim=32, recurrent_dim=64, token_embedding_dim=8)
        learner = HaruhiUniversalPolicy(config)
        historical = HaruhiUniversalPolicy(config)
        registry = LeagueRegistry(root, "test", seed=66002)
        registry.register_checkpoint(historical_manifest(root, historical))
        scheduler = EpisodeSeedScheduler(base_seed=66002, stream_count=2)
        with NodeBatchBridge(
            PROJECT_ROOT,
            count=2,
            base_seed=66002,
            decision_ticks=3,
            max_episode_seconds=0.2,
        ) as bridge:
            collector = LeagueSelfPlayCollector(
                bridge,
                learner,
                config,
                scheduler,
                registry,
            )
            rollout = collector.collect_complete_episodes(maximum_steps=4)
        assert rollout.samples == 2
        assert len(rollout.completed_episodes) == 2
        assert rollout.old_log_prob.shape[1] == 2
        assert all(item["opponentId"] == registry.entries[0].entry_id for item in rollout.completed_episodes)
        assert all(item["learnerSeat"] in {"A", "B"} for item in rollout.completed_episodes)
        assert torch.isfinite(rollout.old_log_prob).all()
