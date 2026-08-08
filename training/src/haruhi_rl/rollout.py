"""双方共享策略的公平自我博弈轨迹采集。"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Callable, Mapping

import torch

from .bridge import NodeBatchBridge
from .distributions import actions_to_environment_payloads, sample_policy
from .model import HaruhiUniversalPolicy
from .seeds import EpisodeSeedScheduler
from .tensors import TensorLimits, encode_frames, flatten_seat_frames


def _to_device(values: Mapping[str, torch.Tensor], device: torch.device) -> dict[str, torch.Tensor]:
    return {key: value.to(device=device) for key, value in values.items()}


@dataclass
class RolloutBatch:
    observations: dict[str, torch.Tensor]
    actions: dict[str, torch.Tensor]
    old_log_prob: torch.Tensor
    old_value: torch.Tensor
    rewards: torch.Tensor
    dones: torch.Tensor
    valid: torch.Tensor
    episode_starts: torch.Tensor
    hidden: torch.Tensor
    bootstrap_value: torch.Tensor
    advantages: torch.Tensor | None = None
    returns: torch.Tensor | None = None
    completed_episodes: tuple[dict[str, Any], ...] = ()

    @property
    def steps(self) -> int:
        return self.rewards.shape[0]

    @property
    def samples(self) -> int:
        return self.rewards.shape[1]

    def compute_returns(self, gamma: float = 1.0, gae_lambda: float = 1.0) -> None:
        advantages = torch.zeros_like(self.rewards)
        running = torch.zeros_like(self.bootstrap_value)
        next_value = self.bootstrap_value
        for step in range(self.steps - 1, -1, -1):
            valid = self.valid[step].to(self.rewards.dtype)
            nonterminal = (~self.dones[step]).to(self.rewards.dtype) * valid
            delta = (
                self.rewards[step]
                + gamma * next_value * nonterminal
                - self.old_value[step]
            ) * valid
            running = (delta + gamma * gae_lambda * nonterminal * running) * valid
            advantages[step] = running
            next_value = self.old_value[step]
        self.advantages = advantages
        self.returns = advantages + self.old_value

    def pad_to_multiple(self, multiple: int) -> None:
        if multiple <= 0:
            raise ValueError("填充倍数必须大于零")
        padding = (-self.steps) % multiple
        if padding == 0:
            return

        def pad_time(value: torch.Tensor, fill: float | bool = 0) -> torch.Tensor:
            shape = (padding, *value.shape[1:])
            extra = torch.full(shape, fill, dtype=value.dtype, device=value.device)
            return torch.cat((value, extra), dim=0)

        self.observations = {key: pad_time(value) for key, value in self.observations.items()}
        self.actions = {key: pad_time(value) for key, value in self.actions.items()}
        self.old_log_prob = pad_time(self.old_log_prob)
        self.old_value = pad_time(self.old_value)
        self.rewards = pad_time(self.rewards)
        self.dones = pad_time(self.dones, True)
        self.valid = pad_time(self.valid, False)
        self.episode_starts = pad_time(self.episode_starts, True)
        self.hidden = pad_time(self.hidden)
        self.advantages = None
        self.returns = None


def concatenate_rollout_batches(batches: list[RolloutBatch]) -> RolloutBatch:
    """沿样本维合并同一冻结策略采集的完整局批次，并以无效时间步对齐长度。"""

    if not batches:
        raise ValueError("至少需要一个轨迹批次")
    observation_keys = batches[0].observations.keys()
    action_keys = batches[0].actions.keys()
    if any(batch.observations.keys() != observation_keys for batch in batches):
        raise ValueError("轨迹观察字段不一致")
    if any(batch.actions.keys() != action_keys for batch in batches):
        raise ValueError("轨迹动作字段不一致")
    target_steps = max(batch.steps for batch in batches)

    def padded(value: torch.Tensor, batch: RolloutBatch, fill: float | bool = 0) -> torch.Tensor:
        padding = target_steps - batch.steps
        if padding <= 0:
            return value
        extra = torch.full(
            (padding, *value.shape[1:]),
            fill,
            dtype=value.dtype,
            device=value.device,
        )
        return torch.cat((value, extra), dim=0)

    combined = RolloutBatch(
        observations={
            key: torch.cat([padded(batch.observations[key], batch) for batch in batches], dim=1)
            for key in observation_keys
        },
        actions={
            key: torch.cat([padded(batch.actions[key], batch) for batch in batches], dim=1)
            for key in action_keys
        },
        old_log_prob=torch.cat([padded(batch.old_log_prob, batch) for batch in batches], dim=1),
        old_value=torch.cat([padded(batch.old_value, batch) for batch in batches], dim=1),
        rewards=torch.cat([padded(batch.rewards, batch) for batch in batches], dim=1),
        dones=torch.cat([padded(batch.dones, batch, True) for batch in batches], dim=1),
        valid=torch.cat([padded(batch.valid, batch, False) for batch in batches], dim=1),
        episode_starts=torch.cat(
            [padded(batch.episode_starts, batch, True) for batch in batches],
            dim=1,
        ),
        hidden=torch.cat([padded(batch.hidden, batch) for batch in batches], dim=1),
        bootstrap_value=torch.cat([batch.bootstrap_value for batch in batches]),
        completed_episodes=tuple(
            episode
            for batch in batches
            for episode in batch.completed_episodes
        ),
    )
    combined.compute_returns()
    return combined


class SelfPlayCollector:
    """当前策略同时控制双方；只读取各自独立的公平观察。"""

    def __init__(
        self,
        bridge: NodeBatchBridge,
        model: HaruhiUniversalPolicy,
        seed_scheduler: EpisodeSeedScheduler,
        *,
        device: torch.device | str = "cpu",
        tensor_limits: TensorLimits = TensorLimits(),
    ) -> None:
        if bridge.count != seed_scheduler.stream_count:
            raise ValueError("批环境数量与种子流数量不一致")
        self.bridge = bridge
        self.model = model
        self.seed_scheduler = seed_scheduler
        self.device = torch.device(device)
        self.tensor_limits = tensor_limits
        self._frames: list[Mapping[str, Any]] | None = None
        self._hidden: torch.Tensor | None = None
        self._episode_start: torch.Tensor | None = None

    def reset(self) -> None:
        options = [self.seed_scheduler.next_options(index) for index in range(self.bridge.count)]
        results = self.bridge.reset(options)
        self._frames = flatten_seat_frames(results)
        sample_count = self.bridge.count * 2
        self._hidden = self.model.initial_hidden(sample_count, device=self.device)
        self._episode_start = torch.ones(sample_count, dtype=torch.bool, device=self.device)

    @torch.no_grad()
    def collect(self, steps: int, *, bootstrap: bool = True) -> RolloutBatch:
        if steps <= 0:
            raise ValueError("轨迹步数必须大于零")
        if self._frames is None:
            self.reset()
        assert self._frames is not None
        assert self._hidden is not None
        assert self._episode_start is not None

        observation_steps: dict[str, list[torch.Tensor]] = {}
        action_steps: dict[str, list[torch.Tensor]] = {}
        log_probs: list[torch.Tensor] = []
        values: list[torch.Tensor] = []
        rewards: list[torch.Tensor] = []
        dones: list[torch.Tensor] = []
        starts: list[torch.Tensor] = []
        hidden_steps: list[torch.Tensor] = []
        completed: list[dict[str, Any]] = []

        self.model.eval()
        for _ in range(steps):
            encoded_cpu = encode_frames(self._frames, limits=self.tensor_limits)
            encoded = _to_device(encoded_cpu, self.device)
            for key, value in encoded_cpu.items():
                observation_steps.setdefault(key, []).append(value)
            starts.append(self._episode_start.detach().cpu())
            hidden_steps.append(self._hidden.detach().cpu())

            output = self.model.forward_step(
                encoded,
                self._hidden,
                episode_start=self._episode_start,
            )
            sample = sample_policy(output, encoded)
            for key, value in sample.actions.items():
                action_steps.setdefault(key, []).append(value.detach().cpu())
            log_probs.append(sample.log_prob.detach().cpu())
            values.append(sample.value.detach().cpu())

            payloads = actions_to_environment_payloads(sample.actions, encoded["own_ships_mask"])
            results = self.bridge.step(payloads)
            reward = torch.empty(self.bridge.count * 2, dtype=torch.float32)
            done = torch.empty(self.bridge.count * 2, dtype=torch.bool)
            next_frames: list[Mapping[str, Any]] = []
            for index, result in enumerate(results):
                reward[index * 2] = float(result["reward"]["A"])
                reward[index * 2 + 1] = float(result["reward"]["B"])
                episode_done = bool(result["terminated"] or result["truncated"])
                done[index * 2 : index * 2 + 2] = episode_done
                if episode_done:
                    completed.append({
                        **result["info"],
                        "reward": dict(result["reward"]),
                        "terminated": bool(result["terminated"]),
                        "truncated": bool(result["truncated"]),
                    })
                    next_result = self.bridge.reset_at(index, self.seed_scheduler.next_options(index))
                else:
                    next_result = result
                next_frames.extend((next_result["seats"]["A"], next_result["seats"]["B"]))

            rewards.append(reward)
            dones.append(done)
            self._frames = next_frames
            self._hidden = sample.hidden.detach()
            self._episode_start = done.to(device=self.device)

        if bootstrap:
            bootstrap_cpu = encode_frames(self._frames, limits=self.tensor_limits)
            bootstrap_input = _to_device(bootstrap_cpu, self.device)
            bootstrap_value = self.model.forward_step(
                bootstrap_input,
                self._hidden,
                episode_start=self._episode_start,
            )["value"].detach().cpu()
        else:
            bootstrap_value = torch.zeros(self.bridge.count * 2, dtype=torch.float32)

        batch = RolloutBatch(
            observations={key: torch.stack(items) for key, items in observation_steps.items()},
            actions={key: torch.stack(items) for key, items in action_steps.items()},
            old_log_prob=torch.stack(log_probs),
            old_value=torch.stack(values),
            rewards=torch.stack(rewards),
            dones=torch.stack(dones),
            valid=torch.ones_like(torch.stack(dones)),
            episode_starts=torch.stack(starts),
            hidden=torch.stack(hidden_steps),
            bootstrap_value=bootstrap_value,
            completed_episodes=tuple(completed),
        )
        if bootstrap:
            batch.compute_returns()
        return batch

    def collect_complete_episodes(
        self,
        maximum_steps: int,
        *,
        progress_hook: Callable[[int], None] | None = None,
        progress_interval: int = 25,
    ) -> RolloutBatch:
        """
        冻结当前策略，直到每个并行环境至少完成一局；只保留各环境第一局。
        这样纯终局奖励可以回传到整局，而不会让 PPO 跨策略版本拼接未完成片段。
        """

        if maximum_steps <= 0:
            raise ValueError("完整局采集上限必须大于零")
        self.reset()
        active = torch.ones(self.bridge.count, dtype=torch.bool)
        segments: list[RolloutBatch] = []
        completed: list[dict[str, Any]] = []
        for step in range(maximum_steps):
            active_before = active.clone()
            segment = self.collect(1, bootstrap=False)
            seat_valid = active_before.repeat_interleave(2)
            segment.valid = seat_valid.unsqueeze(0)
            segment.rewards = segment.rewards * segment.valid.to(segment.rewards.dtype)
            segment.dones = segment.dones | ~segment.valid
            segments.append(segment)
            for episode in segment.completed_episodes:
                stream = int(episode["streamId"])
                local_index = stream - self.seed_scheduler.stream_offset
                if 0 <= local_index < self.bridge.count and active[local_index]:
                    active[local_index] = False
                    completed.append(episode)
            if not torch.any(active):
                break
            if progress_hook is not None and (step + 1) % max(1, progress_interval) == 0:
                progress_hook(step + 1)
        if torch.any(active):
            pending = torch.nonzero(active).flatten().tolist()
            raise RuntimeError(f"以下环境未在采集上限内结束：{pending}")

        observations = {
            key: torch.cat([segment.observations[key] for segment in segments], dim=0)
            for key in segments[0].observations
        }
        actions = {
            key: torch.cat([segment.actions[key] for segment in segments], dim=0)
            for key in segments[0].actions
        }
        sample_count = self.bridge.count * 2
        combined = RolloutBatch(
            observations=observations,
            actions=actions,
            old_log_prob=torch.cat([segment.old_log_prob for segment in segments]),
            old_value=torch.cat([segment.old_value for segment in segments]),
            rewards=torch.cat([segment.rewards for segment in segments]),
            dones=torch.cat([segment.dones for segment in segments]),
            valid=torch.cat([segment.valid for segment in segments]),
            episode_starts=torch.cat([segment.episode_starts for segment in segments]),
            hidden=torch.cat([segment.hidden for segment in segments]),
            bootstrap_value=torch.zeros(sample_count, dtype=torch.float32),
            completed_episodes=tuple(completed),
        )
        combined.compute_returns()
        # 下一轮必须从统一的新策略版本和新对局开始。
        self._frames = None
        self._hidden = None
        self._episode_start = None
        return combined
