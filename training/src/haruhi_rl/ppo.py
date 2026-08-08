"""按时间片回放循环状态的 PPO 更新。"""

from __future__ import annotations

from dataclasses import dataclass

import torch
from torch import nn

from .distributions import sample_policy
from .model import HaruhiUniversalPolicy
from .rollout import RolloutBatch


@dataclass(frozen=True)
class PpoConfig:
    learning_rate: float = 3e-4
    epochs: int = 4
    sequence_length: int = 16
    minibatch_sequences: int = 16
    clip_ratio: float = 0.2
    value_coefficient: float = 0.5
    entropy_coefficient: float = 0.005
    max_grad_norm: float = 0.5
    target_kl: float = 0.03
    gamma: float = 1.0
    gae_lambda: float = 1.0


def _sequence_minibatch(
    rollout: RolloutBatch,
    chunks: list[tuple[int, int]],
    length: int,
    device: torch.device,
) -> tuple[
    dict[str, torch.Tensor],
    dict[str, torch.Tensor],
    torch.Tensor,
    torch.Tensor,
    torch.Tensor,
    torch.Tensor,
    torch.Tensor,
    torch.Tensor,
    torch.Tensor,
]:
    observations = {
        key: torch.stack([value[start : start + length, sample] for start, sample in chunks], dim=1).to(device)
        for key, value in rollout.observations.items()
    }
    actions = {
        key: torch.stack([value[start : start + length, sample] for start, sample in chunks], dim=1).to(device)
        for key, value in rollout.actions.items()
    }
    old_log_prob = torch.stack(
        [rollout.old_log_prob[start : start + length, sample] for start, sample in chunks], dim=1,
    ).to(device)
    old_value = torch.stack(
        [rollout.old_value[start : start + length, sample] for start, sample in chunks], dim=1,
    ).to(device)
    advantages = torch.stack(
        [rollout.advantages[start : start + length, sample] for start, sample in chunks], dim=1,  # type: ignore[index]
    ).to(device)
    returns = torch.stack(
        [rollout.returns[start : start + length, sample] for start, sample in chunks], dim=1,  # type: ignore[index]
    ).to(device)
    starts = torch.stack(
        [rollout.episode_starts[start : start + length, sample] for start, sample in chunks], dim=1,
    ).to(device)
    valid = torch.stack(
        [rollout.valid[start : start + length, sample] for start, sample in chunks], dim=1,
    ).to(device)
    hidden = torch.stack([rollout.hidden[start, sample] for start, sample in chunks]).to(device)
    return observations, actions, old_log_prob, old_value, advantages, returns, starts, valid, hidden


class RecurrentPpoTrainer:
    def __init__(
        self,
        model: HaruhiUniversalPolicy,
        config: PpoConfig = PpoConfig(),
        *,
        device: torch.device | str = "cpu",
    ) -> None:
        self.model = model
        self.config = config
        self.device = torch.device(device)
        self.model.to(self.device)
        self.optimizer = torch.optim.Adam(self.model.parameters(), lr=config.learning_rate, eps=1e-5)

    def update(self, rollout: RolloutBatch) -> dict[str, float]:
        rollout.pad_to_multiple(self.config.sequence_length)
        rollout.compute_returns(self.config.gamma, self.config.gae_lambda)

        advantages = rollout.advantages
        assert advantages is not None
        valid_values = advantages[rollout.valid]
        advantage_mean = valid_values.mean()
        advantage_std = valid_values.std(unbiased=False).clamp_min(1e-8)
        rollout.advantages = (advantages - advantage_mean) / advantage_std

        chunks = [
            (start, sample)
            for sample in range(rollout.samples)
            for start in range(0, rollout.steps, self.config.sequence_length)
            if torch.any(rollout.valid[start : start + self.config.sequence_length, sample])
        ]
        metrics: dict[str, list[float]] = {
            "policy_loss": [],
            "value_loss": [],
            "entropy": [],
            "approx_kl": [],
            "clip_fraction": [],
            "grad_norm": [],
        }
        self.model.train()
        stop_early = False
        for _ in range(self.config.epochs):
            order = torch.randperm(len(chunks)).tolist()
            for offset in range(0, len(order), self.config.minibatch_sequences):
                selected = [chunks[index] for index in order[offset : offset + self.config.minibatch_sequences]]
                (
                    observations,
                    actions,
                    old_log_prob,
                    old_value,
                    batch_advantages,
                    returns,
                    starts,
                    valid,
                    hidden,
                ) = _sequence_minibatch(
                    rollout,
                    selected,
                    self.config.sequence_length,
                    self.device,
                )

                log_prob_steps: list[torch.Tensor] = []
                entropy_steps: list[torch.Tensor] = []
                value_steps: list[torch.Tensor] = []
                for step in range(self.config.sequence_length):
                    step_observation = {key: value[step] for key, value in observations.items()}
                    output = self.model.forward_step(
                        step_observation,
                        hidden,
                        episode_start=starts[step],
                    )
                    step_actions = {key: value[step] for key, value in actions.items()}
                    evaluated = sample_policy(output, step_observation, actions=step_actions)
                    log_prob_steps.append(evaluated.log_prob)
                    entropy_steps.append(evaluated.entropy)
                    value_steps.append(evaluated.value)
                    hidden = evaluated.hidden

                new_log_prob = torch.stack(log_prob_steps)
                entropy = torch.stack(entropy_steps)
                new_value = torch.stack(value_steps)
                log_ratio = new_log_prob - old_log_prob
                ratio = log_ratio.exp()
                unclipped = ratio * batch_advantages
                clipped = ratio.clamp(1 - self.config.clip_ratio, 1 + self.config.clip_ratio) * batch_advantages
                valid_float = valid.to(new_log_prob.dtype)
                valid_count = valid_float.sum().clamp_min(1)
                policy_loss = -(torch.minimum(unclipped, clipped) * valid_float).sum() / valid_count

                value_delta = new_value - old_value
                clipped_value = old_value + value_delta.clamp(
                    -self.config.clip_ratio,
                    self.config.clip_ratio,
                )
                value_errors = torch.maximum(
                    (new_value - returns).square(),
                    (clipped_value - returns).square(),
                )
                value_loss = 0.5 * (value_errors * valid_float).sum() / valid_count
                entropy_mean = (entropy * valid_float).sum() / valid_count
                loss = (
                    policy_loss
                    + self.config.value_coefficient * value_loss
                    - self.config.entropy_coefficient * entropy_mean
                )

                self.optimizer.zero_grad(set_to_none=True)
                loss.backward()
                grad_norm = nn.utils.clip_grad_norm_(self.model.parameters(), self.config.max_grad_norm)
                self.optimizer.step()

                with torch.no_grad():
                    approx_kl = (((ratio - 1) - log_ratio) * valid_float).sum() / valid_count
                    clip_fraction = (
                        (torch.abs(ratio - 1) > self.config.clip_ratio).float() * valid_float
                    ).sum() / valid_count
                metrics["policy_loss"].append(float(policy_loss.detach()))
                metrics["value_loss"].append(float(value_loss.detach()))
                metrics["entropy"].append(float(entropy_mean.detach()))
                metrics["approx_kl"].append(float(approx_kl.detach()))
                metrics["clip_fraction"].append(float(clip_fraction.detach()))
                metrics["grad_norm"].append(float(grad_norm.detach()))
                if float(approx_kl) > self.config.target_kl:
                    stop_early = True
                    break
            if stop_early:
                break

        output_metrics = {
            key: sum(values) / max(1, len(values))
            for key, values in metrics.items()
        }
        output_metrics.update({
            "advantage_mean": float(advantage_mean),
            "advantage_std": float(advantage_std),
            "updates": float(len(metrics["policy_loss"])),
            "early_stop": float(stop_early),
        })
        return output_metrics
