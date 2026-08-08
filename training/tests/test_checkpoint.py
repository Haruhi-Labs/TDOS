from __future__ import annotations

import json
import tempfile
from pathlib import Path

import torch

from haruhi_rl.checkpoint import load_checkpoint, move_optimizer_state, save_checkpoint
from haruhi_rl.model import HaruhiUniversalPolicy, PolicyConfig

PROJECT_ROOT = Path(__file__).resolve().parents[2]
DATA_ROOT = Path("/Volumes/data/haruhi-rl")


def test_checkpoint_round_trip_is_hashed_and_portable() -> None:
    (DATA_ROOT / "tmp").mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="checkpoint-test-", dir=DATA_ROOT / "tmp") as temporary:
        test_root = Path(temporary)
        model = HaruhiUniversalPolicy(PolicyConfig(model_dim=32, recurrent_dim=64, token_embedding_dim=8))
        optimizer = torch.optim.Adam(model.parameters(), lr=1e-3)
        path, manifest = save_checkpoint(
            data_root=test_root,
            run_name="round-trip",
            update=3,
            model=model,
            optimizer=optimizer,
            seed_state={"base_seed": 1, "stream_count": 1, "stream_offset": 0, "counters": [2]},
            config={"test": True},
            project_root=PROJECT_ROOT,
            git_commit="a" * 40,
            status="test",
            metrics={"loss": 0.5},
        )
        payload = load_checkpoint(path, expected_sha256=manifest["sha256"])
        assert payload["update"] == 3
        assert payload["git_commit"] == "a" * 40
        assert payload["config"] == {"test": True}
        assert all(value.device.type == "cpu" for value in payload["model"].values())
        latest = json.loads((path.parent / "latest.json").read_text(encoding="utf-8"))
        assert latest["sha256"] == manifest["sha256"]

        restored = HaruhiUniversalPolicy(PolicyConfig(model_dim=32, recurrent_dim=64, token_embedding_dim=8))
        restored.load_state_dict(payload["model"])
        restored_optimizer = torch.optim.Adam(restored.parameters(), lr=1e-3)
        restored_optimizer.load_state_dict(payload["optimizer"])
        move_optimizer_state(restored_optimizer, torch.device("cpu"))
        for key, value in model.state_dict().items():
            assert torch.equal(value, restored.state_dict()[key])
