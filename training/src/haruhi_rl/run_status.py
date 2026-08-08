"""数据盘训练运行状态的原子写入与轻量汇总。"""

from __future__ import annotations

from datetime import datetime, timezone
import json
import os
from pathlib import Path
import tempfile
import time
from typing import Any

from .diagnostics import analyze_training_metrics
from .resources import GIB, ensure_data_disk_path, evaluate_resource_safety, read_resource_snapshot

RUN_STATUS_SCHEMA_VERSION = 1


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _safe_run_name(value: str) -> str:
    raw = str(value)
    safe = "".join(character for character in raw if character.isalnum() or character in "-_")
    if not safe or safe != raw:
        raise ValueError("训练运行名称只能包含字母、数字、连字符和下划线")
    return safe


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


class RunStatusWriter:
    def __init__(self, data_root: str | Path, run_name: str) -> None:
        root = ensure_data_disk_path(data_root)
        self.run_name = _safe_run_name(run_name)
        self.path = root / "runs" / self.run_name / "status.json"

    def write(
        self,
        *,
        state: str,
        phase: str,
        update: int = 0,
        phase_step: int | None = None,
        details: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        value = {
            "schema_version": RUN_STATUS_SCHEMA_VERSION,
            "run_name": self.run_name,
            "state": str(state),
            "phase": str(phase),
            "update": int(update),
            "phase_step": None if phase_step is None else int(phase_step),
            "pid": os.getpid(),
            "updated_at": _utc_now(),
            "details": details or {},
        }
        _atomic_json(self.path, value)
        return value


def _read_json(path: Path) -> dict[str, Any] | None:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError, OSError):
        return None
    return value if isinstance(value, dict) else None


def _last_jsonl(path: Path) -> dict[str, Any] | None:
    try:
        with path.open("rb") as source:
            source.seek(0, os.SEEK_END)
            position = source.tell()
            buffer = bytearray()
            while position > 0:
                position -= 1
                source.seek(position)
                byte = source.read(1)
                if byte == b"\n" and buffer:
                    break
                if byte != b"\n":
                    buffer.extend(byte)
    except OSError:
        return None
    try:
        value = json.loads(bytes(reversed(buffer)).decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError):
        return None
    return value if isinstance(value, dict) else None


def _jsonl_history(path: Path, maximum_records: int = 200) -> list[dict[str, Any]]:
    try:
        lines = path.read_text(encoding="utf-8").splitlines()
    except OSError:
        return []
    records: list[dict[str, Any]] = []
    for line in lines[-maximum_records:]:
        try:
            value = json.loads(line)
        except json.JSONDecodeError:
            continue
        if isinstance(value, dict):
            records.append(value)
    return records


def _pid_alive(value: Any) -> bool:
    try:
        pid = int(value)
        if pid <= 0:
            return False
        os.kill(pid, 0)
    except (TypeError, ValueError, ProcessLookupError):
        return False
    except PermissionError:
        return True
    return True


def _age_seconds(value: Any, now: float) -> float | None:
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None
    return max(0.0, now - parsed.timestamp())


def _latest_evaluation(directory: Path) -> dict[str, Any] | None:
    candidates = sorted(directory.glob("update_*.json"), reverse=True)
    if not candidates:
        return None
    report = _read_json(candidates[0])
    if not report:
        return None
    summary = report.get("summary") if isinstance(report.get("summary"), dict) else {}
    return {
        "path": str(candidates[0]),
        "checkpoint_update": report.get("checkpoint_update"),
        "assessment": report.get("assessment"),
        "summary": {key: value for key, value in summary.items() if key != "results"},
    }


def collect_run_status(
    data_root: str | Path,
    run_name: str,
    *,
    stale_after_seconds: float = 600,
    now: float | None = None,
) -> dict[str, Any]:
    root = ensure_data_disk_path(data_root)
    safe_run_name = _safe_run_name(run_name)
    run_directory = root / "runs" / safe_run_name
    status = _read_json(run_directory / "status.json")
    metrics_path = run_directory / "metrics.jsonl"
    metrics = _last_jsonl(metrics_path)
    metrics_history = _jsonl_history(metrics_path)
    checkpoint = _read_json(root / "checkpoints" / safe_run_name / "latest.json")
    league = _read_json(root / "league" / safe_run_name / "registry.json")
    evaluation = _latest_evaluation(run_directory / "evaluations")
    snapshot = read_resource_snapshot(root)
    safety = evaluate_resource_safety(snapshot)

    current_time = time.time() if now is None else float(now)
    age = _age_seconds(status.get("updated_at"), current_time) if status else None
    process_alive = _pid_alive(status.get("pid")) if status else False
    incompatible = status is not None and status.get("schema_version") != RUN_STATUS_SCHEMA_VERSION
    raw_state = str(status.get("state", "unknown")) if status else "not_started"
    if incompatible:
        state = "incompatible_status"
    elif raw_state == "running" and (
        not process_alive or age is None or age > stale_after_seconds
    ):
        state = "stale"
    elif raw_state == "not_started" and not safety.allowed:
        state = "blocked_resources"
    else:
        state = raw_state

    return {
        "schema_version": RUN_STATUS_SCHEMA_VERSION,
        "run_name": safe_run_name,
        "state": state,
        "heartbeat_age_seconds": age,
        "process_alive": process_alive,
        "status": status,
        "latest_metrics": metrics,
        "diagnostics": analyze_training_metrics(metrics_history),
        "latest_checkpoint": checkpoint,
        "league": None if not league else {
            "current_rating": league.get("current_rating"),
            "entries": len(league.get("entries", [])),
            "sample_counter": league.get("sample_counter"),
        },
        "latest_evaluation": evaluation,
        "resources": {
            "allowed": safety.allowed,
            "reasons": list(safety.reasons),
            "system_free_gib": snapshot.system_free_bytes / GIB,
            "data_free_gib": snapshot.data_free_bytes / GIB,
            "swap_free_gib": None if snapshot.swap_free_bytes is None else snapshot.swap_free_bytes / GIB,
            "monitor_process_rss_gib": snapshot.process_rss_bytes / GIB,
        },
    }
