"""历史策略联赛、确定性 PFSP 抽样与 Elo 记录。"""

from __future__ import annotations

import json
import math
import os
import random
import tempfile
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any

from .resources import ensure_data_disk_path
from .seeds import mix_episode_seed


@dataclass
class LeagueEntry:
    entry_id: str
    checkpoint_path: str
    sha256: str
    update: int
    rating: float = 1000
    learner_wins: int = 0
    learner_draws: int = 0
    learner_losses: int = 0

    @property
    def games(self) -> int:
        return self.learner_wins + self.learner_draws + self.learner_losses


def _atomic_json(path: Path, value: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, name = tempfile.mkstemp(prefix=f".{path.name}.", suffix=".tmp", dir=path.parent)
    temporary = Path(name)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8") as output:
            json.dump(value, output, ensure_ascii=False, indent=2, sort_keys=True)
            output.flush()
            os.fsync(output.fileno())
        os.replace(temporary, path)
    finally:
        if temporary.exists():
            temporary.unlink()


class LeagueRegistry:
    def __init__(
        self,
        data_root: str | Path,
        run_name: str,
        *,
        seed: int,
        state: dict[str, Any] | None = None,
    ) -> None:
        self.data_root = ensure_data_disk_path(data_root)
        self.run_name = str(run_name)
        self.path = self.data_root / "league" / self.run_name / "registry.json"
        self.seed = int(seed)
        self.sample_counter = 0
        self.current_rating = 1000.0
        self.entries: list[LeagueEntry] = []
        if state is not None:
            self.load_state_dict(state)
        elif self.path.is_file():
            self.load_state_dict(json.loads(self.path.read_text(encoding="utf-8")))

    def state_dict(self) -> dict[str, Any]:
        return {
            "schema_version": 1,
            "run_name": self.run_name,
            "seed": self.seed,
            "sample_counter": self.sample_counter,
            "current_rating": self.current_rating,
            "entries": [asdict(entry) for entry in self.entries],
        }

    def load_state_dict(self, state: dict[str, Any]) -> None:
        if int(state.get("schema_version", 0)) != 1:
            raise ValueError("联赛注册表版本不兼容")
        if str(state["run_name"]) != self.run_name:
            raise ValueError("联赛运行名称不一致")
        self.seed = int(state["seed"])
        self.sample_counter = int(state["sample_counter"])
        self.current_rating = float(state["current_rating"])
        self.entries = [LeagueEntry(**item) for item in state.get("entries", [])]

    def save(self) -> None:
        _atomic_json(self.path, self.state_dict())

    def register_checkpoint(self, manifest: dict[str, Any]) -> LeagueEntry:
        checkpoint_path = str(ensure_data_disk_path(manifest["path"]))
        digest = str(manifest["sha256"])
        update = int(manifest["update"])
        entry_id = f"u{update:06d}-{digest[:10]}"
        existing = next((entry for entry in self.entries if entry.entry_id == entry_id), None)
        if existing:
            return existing
        entry = LeagueEntry(
            entry_id=entry_id,
            checkpoint_path=checkpoint_path,
            sha256=digest,
            update=update,
            rating=self.current_rating,
        )
        self.entries.append(entry)
        self.entries.sort(key=lambda item: (item.update, item.entry_id))
        self.save()
        return entry

    def _next_random(self) -> random.Random:
        seed = mix_episode_seed(self.seed, 0x4C454147, self.sample_counter)
        self.sample_counter += 1
        return random.Random(seed)

    def learner_seat(self) -> str:
        return "A" if self._next_random().random() < 0.5 else "B"

    def sample_opponent(self) -> LeagueEntry:
        if not self.entries:
            raise RuntimeError("联赛中还没有历史策略")
        weights = []
        for entry in self.entries:
            expected = self.expected_score(self.current_rating, entry.rating)
            # PFSP：更偏向当前策略胜率较低的历史对手，同时保留最低覆盖率。
            weights.append(0.05 + (1 - expected) ** 2)
        randomizer = self._next_random()
        threshold = randomizer.random() * sum(weights)
        cumulative = 0.0
        for entry, weight in zip(self.entries, weights, strict=True):
            cumulative += weight
            if cumulative >= threshold:
                return entry
        return self.entries[-1]

    @staticmethod
    def expected_score(rating: float, opponent_rating: float) -> float:
        return 1 / (1 + 10 ** ((opponent_rating - rating) / 400))

    def record_result(self, entry_id: str, learner_score: float, *, k_factor: float = 16) -> None:
        entry = next((item for item in self.entries if item.entry_id == entry_id), None)
        if entry is None:
            raise KeyError(f"未知联赛对手：{entry_id}")
        score = min(1.0, max(0.0, float(learner_score)))
        expected = self.expected_score(self.current_rating, entry.rating)
        delta = k_factor * (score - expected)
        self.current_rating += delta
        entry.rating -= delta
        if math.isclose(score, 0.5):
            entry.learner_draws += 1
        elif score > 0.5:
            entry.learner_wins += 1
        else:
            entry.learner_losses += 1

