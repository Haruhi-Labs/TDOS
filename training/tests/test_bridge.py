from __future__ import annotations

from pathlib import Path

import pytest

from haruhi_rl.bridge import NodeBatchBridge

PROJECT_ROOT = Path(__file__).resolve().parents[2]


def test_node_batch_bridge_round_trip() -> None:
    with NodeBatchBridge(PROJECT_ROOT, count=2, base_seed=22001) as bridge:
        reset = bridge.reset()
        assert len(reset) == 2
        assert reset[0]["schemaVersion"] == 2
        assert reset[0]["reward"] == {"A": 0, "B": 0}
        result = bridge.step([{"A": {}, "B": {}}, {"A": {}, "B": {}}])
        assert len(result) == 2
        assert result[0]["info"]["simulatedTicks"] == 3
        assert result[0]["reward"] == {"A": 0, "B": 0}


def test_bridge_rejects_wrong_batch_size() -> None:
    with NodeBatchBridge(PROJECT_ROOT, count=2, base_seed=22002) as bridge:
        bridge.reset()
        with pytest.raises(ValueError, match="批动作数量"):
            bridge.step([{"A": {}, "B": {}}])
