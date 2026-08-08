"""训练资源采样与安全判定；不修改系统状态。"""

from __future__ import annotations

import os
import re
import shutil
import subprocess
from dataclasses import dataclass
from pathlib import Path

GIB = 1024**3
MIB = 1024**2


@dataclass(frozen=True)
class ResourceSnapshot:
    system_free_bytes: int
    data_free_bytes: int
    process_rss_bytes: int
    swap_total_bytes: int | None
    swap_used_bytes: int | None
    swap_free_bytes: int | None
    memory_free_percent: float | None


@dataclass(frozen=True)
class ResourceThresholds:
    minimum_system_free_bytes: int = 4 * GIB
    minimum_data_free_bytes: int = 40 * GIB
    minimum_swap_free_bytes: int = 256 * MIB
    minimum_memory_free_percent: float = 20
    maximum_process_rss_bytes: int = 10 * GIB


@dataclass(frozen=True)
class SafetyDecision:
    allowed: bool
    reasons: tuple[str, ...]


def ensure_data_disk_path(path: str | Path) -> Path:
    resolved = Path(path).expanduser().resolve()
    data_root = Path("/Volumes/data").resolve()
    if resolved != data_root and data_root not in resolved.parents:
        raise ValueError(f"训练目录必须位于数据盘：{resolved}")
    return resolved


def _swap_usage() -> tuple[int | None, int | None, int | None]:
    try:
        output = subprocess.run(
            ["sysctl", "-n", "vm.swapusage"],
            check=True,
            capture_output=True,
            text=True,
            timeout=2,
        ).stdout
    except (FileNotFoundError, subprocess.SubprocessError):
        return None, None, None
    values: dict[str, int] = {}
    for key, amount, unit in re.findall(r"(total|used|free)\s*=\s*([0-9.]+)([KMG])", output):
        multiplier = {"K": 1024, "M": MIB, "G": GIB}[unit]
        values[key] = int(float(amount) * multiplier)
    return values.get("total"), values.get("used"), values.get("free")


def _process_rss_bytes() -> int:
    try:
        output = subprocess.run(
            ["ps", "-o", "rss=", "-p", str(os.getpid())],
            check=True,
            capture_output=True,
            text=True,
            timeout=2,
        ).stdout.strip()
        return int(output) * 1024
    except (FileNotFoundError, ValueError, subprocess.SubprocessError):
        return 0


def _memory_free_percent() -> float | None:
    try:
        output = subprocess.run(
            ["memory_pressure", "-Q"],
            check=True,
            capture_output=True,
            text=True,
            timeout=3,
        ).stdout
    except (FileNotFoundError, subprocess.SubprocessError):
        return None
    matched = re.search(r"free percentage:\s*([0-9.]+)%", output)
    return float(matched.group(1)) if matched else None


def read_resource_snapshot(data_root: str | Path = "/Volumes/data/haruhi-rl") -> ResourceSnapshot:
    resolved_data_root = ensure_data_disk_path(data_root)
    system = shutil.disk_usage("/")
    data = shutil.disk_usage(resolved_data_root)
    swap_total, swap_used, swap_free = _swap_usage()
    return ResourceSnapshot(
        system_free_bytes=system.free,
        data_free_bytes=data.free,
        process_rss_bytes=_process_rss_bytes(),
        swap_total_bytes=swap_total,
        swap_used_bytes=swap_used,
        swap_free_bytes=swap_free,
        memory_free_percent=_memory_free_percent(),
    )


def evaluate_resource_safety(
    snapshot: ResourceSnapshot,
    thresholds: ResourceThresholds = ResourceThresholds(),
) -> SafetyDecision:
    reasons: list[str] = []
    if snapshot.system_free_bytes < thresholds.minimum_system_free_bytes:
        reasons.append(
            f"系统盘可用空间不足：{snapshot.system_free_bytes / GIB:.2f} GiB"
            f" < {thresholds.minimum_system_free_bytes / GIB:.2f} GiB",
        )
    if snapshot.data_free_bytes < thresholds.minimum_data_free_bytes:
        reasons.append(
            f"数据盘可用空间不足：{snapshot.data_free_bytes / GIB:.2f} GiB"
            f" < {thresholds.minimum_data_free_bytes / GIB:.2f} GiB",
        )
    if (
        snapshot.memory_free_percent is not None
        and snapshot.memory_free_percent < thresholds.minimum_memory_free_percent
    ):
        reasons.append(
            f"实时可用内存比例不足：{snapshot.memory_free_percent:.1f}%"
            f" < {thresholds.minimum_memory_free_percent:.1f}%",
        )
    if (
        snapshot.swap_free_bytes is not None
        and snapshot.swap_free_bytes < thresholds.minimum_swap_free_bytes
    ):
        reasons.append(
            f"交换空间余量不足：{snapshot.swap_free_bytes / GIB:.2f} GiB"
            f" < {thresholds.minimum_swap_free_bytes / GIB:.2f} GiB",
        )
    if snapshot.process_rss_bytes > thresholds.maximum_process_rss_bytes:
        reasons.append(
            f"训练进程内存过高：{snapshot.process_rss_bytes / GIB:.2f} GiB"
            f" > {thresholds.maximum_process_rss_bytes / GIB:.2f} GiB",
        )
    return SafetyDecision(allowed=not reasons, reasons=tuple(reasons))
