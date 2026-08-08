"""当前策略对历史策略的完整局联赛轨迹采集。"""

from __future__ import annotations

from collections import defaultdict
from typing import Any, Mapping

import torch

from .bridge import NodeBatchBridge
from .checkpoint import load_checkpoint
from .distributions import actions_to_environment_payloads, sample_policy
from .league import LeagueEntry, LeagueRegistry
from .model import HaruhiUniversalPolicy, PolicyConfig
from .rollout import RolloutBatch, _to_device
from .seeds import EpisodeSeedScheduler
from .tensors import TensorLimits, encode_frames, flatten_seat_frames


def _index_tensors(values: Mapping[str, torch.Tensor], indices: torch.Tensor) -> dict[str, torch.Tensor]:
    return {key: value.index_select(0, indices) for key, value in values.items()}


def _empty_actions(sample_actions: Mapping[str, torch.Tensor], sample_count: int) -> dict[str, torch.Tensor]:
    return {
        key: torch.zeros((sample_count, *value.shape[1:]), dtype=value.dtype, device=value.device)
        for key, value in sample_actions.items()
    }


class LeagueSelfPlayCollector:
    """每个环境随机指定当前策略席位，另一席位由历史检查点控制。"""

    def __init__(
        self,
        bridge: NodeBatchBridge,
        learner: HaruhiUniversalPolicy,
        model_config: PolicyConfig,
        seed_scheduler: EpisodeSeedScheduler,
        registry: LeagueRegistry,
        *,
        device: torch.device | str = "cpu",
        tensor_limits: TensorLimits = TensorLimits(),
    ) -> None:
        self.bridge = bridge
        self.learner = learner
        self.model_config = model_config
        self.seed_scheduler = seed_scheduler
        self.registry = registry
        self.device = torch.device(device)
        self.tensor_limits = tensor_limits

    def _load_opponents(
        self,
        assignments: list[LeagueEntry],
    ) -> dict[str, HaruhiUniversalPolicy]:
        models: dict[str, HaruhiUniversalPolicy] = {}
        for entry in assignments:
            if entry.entry_id in models:
                continue
            payload = load_checkpoint(entry.checkpoint_path, expected_sha256=entry.sha256)
            model = HaruhiUniversalPolicy(self.model_config)
            model.load_state_dict(payload["model"])
            model.to(self.device).eval()
            for parameter in model.parameters():
                parameter.requires_grad_(False)
            models[entry.entry_id] = model
        return models

    @torch.no_grad()
    def collect_complete_episodes(self, maximum_steps: int) -> RolloutBatch:
        if not self.registry.entries:
            raise RuntimeError("历史联赛采集需要至少一个历史检查点")
        environment_count = self.bridge.count
        options = [self.seed_scheduler.next_options(index) for index in range(environment_count)]
        results = self.bridge.reset(options)
        frames = flatten_seat_frames(results)
        learner_seats = [self.registry.learner_seat() for _ in range(environment_count)]
        opponents = [self.registry.sample_opponent() for _ in range(environment_count)]
        opponent_models = self._load_opponents(opponents)
        learner_indices = torch.tensor(
            [index * 2 + (0 if learner_seats[index] == "A" else 1) for index in range(environment_count)],
            dtype=torch.long,
            device=self.device,
        )
        assignments: list[str] = []
        for index, seat in enumerate(learner_seats):
            assignments.extend(("learner", opponents[index].entry_id) if seat == "A" else (opponents[index].entry_id, "learner"))

        sample_count = environment_count * 2
        hidden = self.learner.initial_hidden(sample_count, device=self.device)
        episode_start = torch.ones(sample_count, dtype=torch.bool, device=self.device)
        active = torch.ones(environment_count, dtype=torch.bool)
        observation_steps: dict[str, list[torch.Tensor]] = {}
        action_steps: dict[str, list[torch.Tensor]] = {}
        log_probs: list[torch.Tensor] = []
        values: list[torch.Tensor] = []
        rewards: list[torch.Tensor] = []
        dones: list[torch.Tensor] = []
        valid_steps: list[torch.Tensor] = []
        starts: list[torch.Tensor] = []
        hidden_steps: list[torch.Tensor] = []
        completed: list[dict[str, Any]] = []

        self.learner.eval()
        for _ in range(maximum_steps):
            encoded_cpu = encode_frames(frames, limits=self.tensor_limits)
            encoded = _to_device(encoded_cpu, self.device)
            learner_encoded_cpu = {
                key: value.index_select(0, learner_indices.cpu())
                for key, value in encoded_cpu.items()
            }
            for key, value in learner_encoded_cpu.items():
                observation_steps.setdefault(key, []).append(value)
            active_before = active.clone()
            valid_steps.append(active_before)
            starts.append(episode_start.index_select(0, learner_indices).cpu())
            hidden_steps.append(hidden.index_select(0, learner_indices).cpu())

            groups: dict[str, list[int]] = defaultdict(list)
            for index, assignment in enumerate(assignments):
                groups[assignment].append(index)
            merged_actions: dict[str, torch.Tensor] | None = None
            next_hidden = torch.zeros_like(hidden)
            learner_log_prob = torch.empty(environment_count, device=self.device)
            learner_value = torch.empty(environment_count, device=self.device)
            learner_actions: dict[str, torch.Tensor] | None = None
            for assignment, raw_indices in groups.items():
                indices = torch.tensor(raw_indices, dtype=torch.long, device=self.device)
                policy = self.learner if assignment == "learner" else opponent_models[assignment]
                subset = _index_tensors(encoded, indices)
                output = policy.forward_step(
                    subset,
                    hidden.index_select(0, indices),
                    episode_start=episode_start.index_select(0, indices),
                )
                sample = sample_policy(output, subset)
                if merged_actions is None:
                    merged_actions = _empty_actions(sample.actions, sample_count)
                for key, value in sample.actions.items():
                    merged_actions[key].index_copy_(0, indices, value)
                next_hidden.index_copy_(0, indices, sample.hidden)
                if assignment == "learner":
                    learner_log_prob.copy_(sample.log_prob)
                    learner_value.copy_(sample.value)
                    learner_actions = {key: value.cpu() for key, value in sample.actions.items()}
            assert merged_actions is not None
            assert learner_actions is not None
            for key, value in learner_actions.items():
                action_steps.setdefault(key, []).append(value)
            log_probs.append(learner_log_prob.cpu())
            values.append(learner_value.cpu())

            payloads = actions_to_environment_payloads(merged_actions, encoded["own_ships_mask"])
            results = self.bridge.step(payloads)
            reward = torch.zeros(environment_count, dtype=torch.float32)
            done = torch.zeros(environment_count, dtype=torch.bool)
            next_frames: list[Mapping[str, Any]] = []
            for index, result in enumerate(results):
                learner_seat = learner_seats[index]
                reward[index] = float(result["reward"][learner_seat]) if active_before[index] else 0
                episode_done = bool(result["terminated"] or result["truncated"])
                done[index] = episode_done or not active_before[index]
                if episode_done and active[index]:
                    active[index] = False
                    winner = result["winnerSeat"] if "winnerSeat" in result else result["info"]["winnerSeat"]
                    learner_score = 0.5 if winner is None else float(winner == learner_seat)
                    completed.append({
                        **result["info"],
                        "learnerSeat": learner_seat,
                        "opponentId": opponents[index].entry_id,
                        "learnerScore": learner_score,
                        "reward": float(result["reward"][learner_seat]),
                        "terminated": bool(result["terminated"]),
                        "truncated": bool(result["truncated"]),
                    })
                if episode_done:
                    next_result = self.bridge.reset_at(index, self.seed_scheduler.next_options(index))
                else:
                    next_result = result
                next_frames.extend((next_result["seats"]["A"], next_result["seats"]["B"]))
            rewards.append(reward)
            dones.append(done)
            frames = next_frames
            hidden = next_hidden
            episode_start = torch.repeat_interleave(done.to(self.device), 2)
            if not torch.any(active):
                break
        if torch.any(active):
            raise RuntimeError(f"联赛环境未在采集上限内结束：{torch.nonzero(active).flatten().tolist()}")

        batch = RolloutBatch(
            observations={key: torch.stack(value) for key, value in observation_steps.items()},
            actions={key: torch.stack(value) for key, value in action_steps.items()},
            old_log_prob=torch.stack(log_probs),
            old_value=torch.stack(values),
            rewards=torch.stack(rewards),
            dones=torch.stack(dones),
            valid=torch.stack(valid_steps),
            episode_starts=torch.stack(starts),
            hidden=torch.stack(hidden_steps),
            bootstrap_value=torch.zeros(environment_count),
            completed_episodes=tuple(completed),
        )
        batch.compute_returns()
        return batch
