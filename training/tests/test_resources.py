from __future__ import annotations

from pathlib import Path

import pytest

from haruhi_rl.resources import (
    GIB,
    ResourceSnapshot,
    ResourceThresholds,
    ensure_data_disk_path,
    evaluate_resource_safety,
    read_resource_snapshot,
)


def snapshot(**overrides: int | None) -> ResourceSnapshot:
    values: dict[str, int | None] = {
        "system_free_bytes": 12 * GIB,
        "data_free_bytes": 100 * GIB,
        "process_rss_bytes": 2 * GIB,
        "swap_total_bytes": 12 * GIB,
        "swap_used_bytes": 4 * GIB,
        "swap_free_bytes": 8 * GIB,
    }
    values.update(overrides)
    return ResourceSnapshot(**values)  # type: ignore[arg-type]


def test_safe_snapshot_is_allowed() -> None:
    decision = evaluate_resource_safety(snapshot())
    assert decision.allowed
    assert decision.reasons == ()


def test_each_pressure_source_blocks_training() -> None:
    thresholds = ResourceThresholds()
    decision = evaluate_resource_safety(
        snapshot(
            system_free_bytes=thresholds.minimum_system_free_bytes - 1,
            data_free_bytes=thresholds.minimum_data_free_bytes - 1,
            swap_free_bytes=thresholds.minimum_swap_free_bytes - 1,
            process_rss_bytes=thresholds.maximum_process_rss_bytes + 1,
        ),
    )
    assert not decision.allowed
    assert len(decision.reasons) == 4


def test_training_path_must_stay_on_data_disk() -> None:
    assert ensure_data_disk_path("/Volumes/data/haruhi-rl") == Path("/Volumes/data/haruhi-rl")
    with pytest.raises(ValueError, match="必须位于数据盘"):
        ensure_data_disk_path("/tmp/haruhi-rl")


def test_real_snapshot_is_read_only_and_well_formed() -> None:
    current = read_resource_snapshot("/Volumes/data/haruhi-rl")
    assert current.system_free_bytes > 0
    assert current.data_free_bytes > 0
    assert current.process_rss_bytes >= 0
