"""可保存、可复现的并行对局种子调度。"""

from __future__ import annotations

from dataclasses import dataclass, field


def _u32(value: int) -> int:
    return int(value) & 0xFFFFFFFF


def mix_episode_seed(base_seed: int, stream: int, episode: int) -> int:
    value = _u32(base_seed) ^ _u32((stream + 1) * 0x9E3779B1)
    value ^= _u32((episode + 1) * 0x85EBCA77)
    value ^= value >> 16
    value = _u32(value * 0x7FEB352D)
    value ^= value >> 15
    value = _u32(value * 0x846CA68B)
    value ^= value >> 16
    return _u32(value)


@dataclass
class EpisodeSeedScheduler:
    base_seed: int
    stream_count: int
    stream_offset: int = 0
    counters: list[int] = field(default_factory=list)

    def __post_init__(self) -> None:
        if self.stream_count <= 0:
            raise ValueError("种子流数量必须大于零")
        if not self.counters:
            self.counters = [0] * self.stream_count
        if len(self.counters) != self.stream_count:
            raise ValueError("种子计数器数量与环境数量不一致")

    def next_seed(self, index: int) -> int:
        if index < 0 or index >= self.stream_count:
            raise IndexError(f"种子流下标越界：{index}")
        episode = self.counters[index]
        self.counters[index] += 1
        return mix_episode_seed(self.base_seed, self.stream_offset + index, episode)

    def next_options(self, index: int) -> dict[str, int]:
        return {"seed": self.next_seed(index)}

    def state_dict(self) -> dict[str, object]:
        return {
            "base_seed": int(self.base_seed),
            "stream_count": int(self.stream_count),
            "stream_offset": int(self.stream_offset),
            "counters": list(self.counters),
        }

    @classmethod
    def from_state_dict(cls, state: dict[str, object]) -> EpisodeSeedScheduler:
        return cls(
            base_seed=int(state["base_seed"]),
            stream_count=int(state["stream_count"]),
            stream_offset=int(state.get("stream_offset", 0)),
            counters=[int(value) for value in state["counters"]],  # type: ignore[index]
        )
