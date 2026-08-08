from __future__ import annotations

from datetime import datetime, timedelta, timezone
import json
import os
from pathlib import Path
import tempfile

import pytest

from haruhi_rl.run_status import RunStatusWriter, collect_run_status

DATA_TMP = Path("/Volumes/data/haruhi-rl/tmp")


def test_status_writer_and_monitor_summary() -> None:
    DATA_TMP.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="status-test-", dir=DATA_TMP) as temporary:
        root = Path(temporary)
        writer = RunStatusWriter(root, "test-run")
        written = writer.write(state="running", phase="collecting", update=3, phase_step=25)
        run_directory = root / "runs" / "test-run"
        with (run_directory / "metrics.jsonl").open("w", encoding="utf-8") as output:
            output.write(json.dumps({"update": 2, "entropy": 1.2}) + "\n")
            output.write(json.dumps({"update": 3, "entropy": 1.1}) + "\n")
        status = collect_run_status(root, "test-run")
        assert status["state"] == "running"
        assert status["process_alive"]
        assert status["status"]["phase_step"] == 25
        assert status["latest_metrics"]["update"] == 3
        assert written["pid"] == os.getpid()


def test_dead_or_old_running_status_is_stale() -> None:
    DATA_TMP.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="status-stale-", dir=DATA_TMP) as temporary:
        root = Path(temporary)
        writer = RunStatusWriter(root, "stale-run")
        value = writer.write(state="running", phase="collecting")
        value["pid"] = 999_999_999
        value["updated_at"] = (datetime.now(timezone.utc) - timedelta(hours=1)).isoformat()
        writer.path.write_text(json.dumps(value), encoding="utf-8")
        status = collect_run_status(root, "stale-run", stale_after_seconds=60)
        assert status["state"] == "stale"
        assert not status["process_alive"]


def test_run_name_cannot_escape_data_root() -> None:
    with pytest.raises(ValueError, match="运行名称"):
        RunStatusWriter(DATA_TMP, "../escape")
