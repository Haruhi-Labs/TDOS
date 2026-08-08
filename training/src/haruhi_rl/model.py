"""通用、角色无关的循环实体策略网络。"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Mapping

import torch
from torch import nn

from .tensors import (
    BEAM_FEATURE_NAMES,
    GLOBAL_FEATURE_NAMES,
    OPPONENT_FEATURE_NAMES,
    OWN_AUX_FEATURE_NAMES,
    OWN_SHIP_FEATURE_NAMES,
    PROJECTILE_FEATURE_NAMES,
    RADAR_FEATURE_NAMES,
    TOKEN_BUCKETS,
    VISION_WAVE_FEATURE_NAMES,
)


@dataclass(frozen=True)
class PolicyConfig:
    model_dim: int = 128
    recurrent_dim: int = 256
    token_embedding_dim: int = 16
    token_buckets: int = TOKEN_BUCKETS


class EntityEncoder(nn.Module):
    def __init__(
        self,
        numeric_width: int,
        token_fields: int,
        config: PolicyConfig,
        token_embedding: nn.Embedding,
    ) -> None:
        super().__init__()
        self.token_fields = token_fields
        self.token_embedding = token_embedding
        width = numeric_width + token_fields * config.token_embedding_dim
        self.network = nn.Sequential(
            nn.Linear(width, config.model_dim),
            nn.LayerNorm(config.model_dim),
            nn.SiLU(),
            nn.Linear(config.model_dim, config.model_dim),
            nn.SiLU(),
        )

    def forward(self, numeric: torch.Tensor, tokens: torch.Tensor) -> torch.Tensor:
        if self.token_fields:
            embedded = self.token_embedding(tokens).flatten(start_dim=-2)
            values = torch.cat((numeric, embedded), dim=-1)
        else:
            values = numeric
        return self.network(values)


class MaskedAttentionPool(nn.Module):
    def __init__(self, width: int) -> None:
        super().__init__()
        self.score = nn.Sequential(
            nn.Linear(width, width),
            nn.Tanh(),
            nn.Linear(width, 1, bias=False),
        )

    def forward(self, values: torch.Tensor, mask: torch.Tensor) -> torch.Tensor:
        scores = self.score(values).squeeze(-1)
        masked_scores = scores.masked_fill(~mask, -1e4)
        weights = torch.softmax(masked_scores, dim=-1) * mask.to(values.dtype)
        weights = weights / weights.sum(dim=-1, keepdim=True).clamp_min(1e-8)
        return torch.sum(values * weights.unsqueeze(-1), dim=-2)


class HaruhiUniversalPolicy(nn.Module):
    """实体集合编码 + 全局 GRU + 每舰共享动作头。"""

    def __init__(self, config: PolicyConfig = PolicyConfig()) -> None:
        super().__init__()
        if config.model_dim < config.token_embedding_dim:
            raise ValueError("model_dim 不能小于 token_embedding_dim")
        self.config = config
        self.token_embedding = nn.Embedding(
            config.token_buckets,
            config.token_embedding_dim,
            padding_idx=0,
        )
        self.global_encoder = nn.Sequential(
            nn.Linear(len(GLOBAL_FEATURE_NAMES), config.model_dim),
            nn.LayerNorm(config.model_dim),
            nn.SiLU(),
            nn.Linear(config.model_dim, config.model_dim),
            nn.SiLU(),
        )
        self.own_ship_encoder = EntityEncoder(
            len(OWN_SHIP_FEATURE_NAMES), 3, config, self.token_embedding,
        )
        self.own_aux_encoder = EntityEncoder(
            len(OWN_AUX_FEATURE_NAMES), 2, config, self.token_embedding,
        )
        self.opponent_encoder = EntityEncoder(
            len(OPPONENT_FEATURE_NAMES), 3, config, self.token_embedding,
        )
        self.projectile_encoder = EntityEncoder(
            len(PROJECTILE_FEATURE_NAMES), 3, config, self.token_embedding,
        )
        self.beam_encoder = EntityEncoder(
            len(BEAM_FEATURE_NAMES), 3, config, self.token_embedding,
        )
        self.wave_encoder = EntityEncoder(
            len(VISION_WAVE_FEATURE_NAMES), 2, config, self.token_embedding,
        )
        self.radar_encoder = EntityEncoder(
            len(RADAR_FEATURE_NAMES), 3, config, self.token_embedding,
        )

        self.pools = nn.ModuleDict({
            name: MaskedAttentionPool(config.model_dim)
            for name in ("ships", "aux", "opponents", "projectiles", "beams", "waves", "radar")
        })
        context_sources = 1 + len(self.pools) + 1
        self.context_fusion = nn.Sequential(
            nn.Linear(context_sources * config.model_dim, config.recurrent_dim),
            nn.LayerNorm(config.recurrent_dim),
            nn.SiLU(),
            nn.Linear(config.recurrent_dim, config.recurrent_dim),
            nn.SiLU(),
        )
        self.recurrent = nn.GRUCell(config.recurrent_dim, config.recurrent_dim)
        self.value_head = nn.Sequential(
            nn.Linear(config.recurrent_dim, config.model_dim),
            nn.SiLU(),
            nn.Linear(config.model_dim, 1),
        )

        self.ship_context = nn.Sequential(
            nn.Linear(config.model_dim + config.recurrent_dim, config.recurrent_dim),
            nn.LayerNorm(config.recurrent_dim),
            nn.SiLU(),
        )
        self.ship_navigation = nn.Linear(config.recurrent_dim, 3)
        self.ship_set_gear = nn.Linear(config.recurrent_dim, 2)
        self.ship_gear = nn.Linear(config.recurrent_dim, 5)
        self.ship_brake = nn.Linear(config.recurrent_dim, 2)
        self.ship_subskill = nn.Linear(config.recurrent_dim, 2)
        self.ship_subzone = nn.Linear(config.recurrent_dim, 9)
        self.ship_continuous_mean = nn.Linear(config.recurrent_dim, 6)
        self.ship_continuous_log_std = nn.Parameter(torch.full((6,), -0.4))

        self.split_head = nn.Linear(config.recurrent_dim, 3)
        self.scout_launch_head = nn.Linear(config.recurrent_dim, 2)
        self.scout_source_query = nn.Linear(config.recurrent_dim, config.model_dim)
        self.scout_zone_head = nn.Linear(config.recurrent_dim, 9)
        self.flagship_head = nn.Linear(config.recurrent_dim, 2)
        self.flagship_zone_head = nn.Linear(config.recurrent_dim, 9)
        self.flagship_continuous_mean = nn.Linear(config.recurrent_dim, 2)
        self.flagship_continuous_log_std = nn.Parameter(torch.full((2,), -0.4))

    def initial_hidden(
        self,
        batch_size: int,
        *,
        device: torch.device | str | None = None,
        dtype: torch.dtype | None = None,
    ) -> torch.Tensor:
        parameter = next(self.parameters())
        return torch.zeros(
            batch_size,
            self.config.recurrent_dim,
            device=device or parameter.device,
            dtype=dtype or parameter.dtype,
        )

    def _support_pool(self, tensors: Mapping[str, torch.Tensor]) -> torch.Tensor:
        embedded = self.token_embedding(tensors["support_tokens"])
        mask = tensors["support_mask"].unsqueeze(-1).to(embedded.dtype)
        return (embedded * mask).sum(dim=1) / mask.sum(dim=1).clamp_min(1)

    def forward_step(
        self,
        tensors: Mapping[str, torch.Tensor],
        hidden: torch.Tensor | None = None,
        episode_start: torch.Tensor | None = None,
    ) -> dict[str, torch.Tensor]:
        batch_size = tensors["global"].shape[0]
        if hidden is None:
            hidden = self.initial_hidden(batch_size, device=tensors["global"].device)
        if episode_start is not None:
            hidden = hidden * (~episode_start.bool()).to(hidden.dtype).unsqueeze(-1)

        global_encoded = self.global_encoder(tensors["global"])
        own_ships = self.own_ship_encoder(tensors["own_ships"], tensors["own_ship_tokens"])
        own_aux = self.own_aux_encoder(tensors["own_aux"], tensors["own_aux_tokens"])
        opponents = self.opponent_encoder(tensors["opponents"], tensors["opponent_tokens"])
        projectiles = self.projectile_encoder(tensors["projectiles"], tensors["projectile_tokens"])
        beams = self.beam_encoder(tensors["beams"], tensors["beam_tokens"])
        waves = self.wave_encoder(tensors["vision_waves"], tensors["vision_wave_tokens"])
        radar = self.radar_encoder(tensors["radar"], tensors["radar_tokens"])

        support = self._support_pool(tensors)
        support = torch.nn.functional.pad(
            support,
            (0, self.config.model_dim - self.config.token_embedding_dim),
        )
        pooled = [
            global_encoded,
            self.pools["ships"](own_ships, tensors["own_ships_mask"]),
            self.pools["aux"](own_aux, tensors["own_aux_mask"]),
            self.pools["opponents"](opponents, tensors["opponents_mask"]),
            self.pools["projectiles"](projectiles, tensors["projectiles_mask"]),
            self.pools["beams"](beams, tensors["beams_mask"]),
            self.pools["waves"](waves, tensors["vision_waves_mask"]),
            self.pools["radar"](radar, tensors["radar_mask"]),
            support,
        ]
        fused = self.context_fusion(torch.cat(pooled, dim=-1))
        next_hidden = self.recurrent(fused, hidden)

        expanded_context = next_hidden.unsqueeze(1).expand(-1, own_ships.shape[1], -1)
        ship_context = self.ship_context(torch.cat((own_ships, expanded_context), dim=-1))
        scout_query = self.scout_source_query(next_hidden).unsqueeze(1)
        scout_source_logits = torch.sum(own_ships * scout_query, dim=-1) / math_sqrt(
            self.config.model_dim,
        )
        ship_continuous_mean = self.ship_continuous_mean(ship_context)

        return {
            "hidden": next_hidden,
            "value": self.value_head(next_hidden).squeeze(-1),
            "ship_navigation_logits": self.ship_navigation(ship_context),
            "ship_set_gear_logits": self.ship_set_gear(ship_context),
            "ship_gear_logits": self.ship_gear(ship_context),
            "ship_brake_logits": self.ship_brake(ship_context),
            "ship_subskill_logits": self.ship_subskill(ship_context),
            "ship_subzone_logits": self.ship_subzone(ship_context),
            "ship_continuous_mean": ship_continuous_mean,
            "ship_continuous_log_std": self.ship_continuous_log_std.expand_as(
                ship_continuous_mean,
            ),
            "split_logits": self.split_head(next_hidden),
            "scout_launch_logits": self.scout_launch_head(next_hidden),
            "scout_source_logits": scout_source_logits,
            "scout_zone_logits": self.scout_zone_head(next_hidden),
            "flagship_logits": self.flagship_head(next_hidden),
            "flagship_zone_logits": self.flagship_zone_head(next_hidden),
            "flagship_continuous_mean": self.flagship_continuous_mean(next_hidden),
            "flagship_continuous_log_std": self.flagship_continuous_log_std.expand(
                batch_size, -1,
            ),
        }


def math_sqrt(value: int) -> float:
    # 单独保留为纯 Python 常数，导出 ONNX 时不会创建多余张量。
    return float(value) ** 0.5
