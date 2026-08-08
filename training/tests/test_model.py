from __future__ import annotations

from pathlib import Path

import torch

from haruhi_rl.bridge import NodeBatchBridge
from haruhi_rl.distributions import actions_to_environment_payloads, sample_policy
from haruhi_rl.model import HaruhiUniversalPolicy, PolicyConfig
from haruhi_rl.tensors import encode_frames, flatten_seat_frames

PROJECT_ROOT = Path(__file__).resolve().parents[2]


def tensors_for_reset(count: int = 2) -> dict[str, torch.Tensor]:
    with NodeBatchBridge(PROJECT_ROOT, count=count, base_seed=44001) as bridge:
        return encode_frames(flatten_seat_frames(bridge.reset()))


def test_model_forward_shapes_and_parameter_budget() -> None:
    tensors = tensors_for_reset()
    model = HaruhiUniversalPolicy(PolicyConfig(model_dim=64, recurrent_dim=128))
    output = model.forward_step(tensors)
    batch, ships = tensors["own_ships_mask"].shape
    assert output["hidden"].shape == (batch, 128)
    assert output["value"].shape == (batch,)
    assert output["ship_navigation_logits"].shape == (batch, ships, 3)
    assert output["ship_continuous_mean"].shape == (batch, ships, 6)
    assert output["scout_source_logits"].shape == (batch, ships)
    assert output["flagship_continuous_mean"].shape == (batch, 2)
    assert all(torch.isfinite(value).all() for value in output.values())
    parameter_count = sum(parameter.numel() for parameter in model.parameters())
    assert parameter_count < 5_000_000


def test_sample_obeys_masks_and_round_trips_log_probability() -> None:
    tensors = tensors_for_reset()
    torch.manual_seed(7)
    model = HaruhiUniversalPolicy(PolicyConfig(model_dim=64, recurrent_dim=128))
    output = model.forward_step(tensors)
    sampled = sample_policy(output, tensors)

    padded = ~tensors["own_ships_mask"]
    assert torch.all(sampled.actions["ship_navigation"][padded] == 0)
    assert torch.all(sampled.actions["ship_brake"][~tensors["action_ship_flags"][..., 1]] == 0)
    assert torch.all(sampled.actions["ship_subskill"][~tensors["action_ship_flags"][..., 2]] == 0)
    assert torch.all(sampled.actions["flagship_cast"][~tensors["action_flagship"]] == 0)
    assert torch.isfinite(sampled.log_prob).all()
    assert torch.isfinite(sampled.entropy).all()

    evaluated = sample_policy(output, tensors, actions=sampled.actions)
    assert torch.allclose(sampled.log_prob, evaluated.log_prob, atol=2e-5)


def test_deterministic_action_and_environment_payload() -> None:
    tensors = tensors_for_reset()
    model = HaruhiUniversalPolicy(PolicyConfig(model_dim=64, recurrent_dim=128))
    output = model.forward_step(tensors)
    first = sample_policy(output, tensors, deterministic=True)
    second = sample_policy(output, tensors, deterministic=True)
    for key in first.actions:
        assert torch.equal(first.actions[key], second.actions[key])
    payloads = actions_to_environment_payloads(first.actions, tensors["own_ships_mask"])
    assert len(payloads) == 2
    assert set(payloads[0]) == {"A", "B"}
    assert len(payloads[0]["A"]["ships"]) == 3
    assert 1 <= payloads[0]["A"]["scout"]["zone"] <= 9


def test_recurrent_reset_and_gradient_are_finite() -> None:
    tensors = tensors_for_reset(1)
    model = HaruhiUniversalPolicy(PolicyConfig(model_dim=64, recurrent_dim=128))
    first_output = model.forward_step(tensors)
    carried = model.forward_step(tensors, first_output["hidden"])
    reset = model.forward_step(
        tensors,
        first_output["hidden"],
        episode_start=torch.ones(tensors["global"].shape[0], dtype=torch.bool),
    )
    fresh = model.forward_step(tensors)
    assert not torch.allclose(carried["hidden"], fresh["hidden"])
    assert torch.allclose(reset["hidden"], fresh["hidden"], atol=1e-6)

    sampled = sample_policy(first_output, tensors)
    loss = -(sampled.log_prob.mean() + 0.01 * sampled.entropy.mean()) + sampled.value.square().mean()
    loss.backward()
    gradients = [parameter.grad for parameter in model.parameters() if parameter.grad is not None]
    assert gradients
    assert all(torch.isfinite(gradient).all() for gradient in gradients)
