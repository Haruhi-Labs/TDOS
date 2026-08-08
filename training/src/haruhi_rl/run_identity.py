"""训练运行的源码身份、配置指纹与防误覆盖约束。"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
import fcntl
import hashlib
import json
import os
from pathlib import Path
import subprocess
import tempfile
from typing import Any

from .resources import ensure_data_disk_path

RUN_MANIFEST_SCHEMA_VERSION = 1


@dataclass(frozen=True)
class RunIdentity:
    git_commit: str
    config_sha256: str
    manifest_path: Path
    _lease: RunLease

    def close(self) -> None:
        self._lease.close()


class RunLease:
    """以进程持有的文件锁阻止同一运行被并发启动。"""

    def __init__(self, path: Path) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        self._source = path.open("a+", encoding="utf-8")
        try:
            fcntl.flock(self._source.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as error:
            self._source.close()
            raise RuntimeError("该训练运行已有活动进程") from error
        self._source.seek(0)
        self._source.truncate()
        json.dump(
            {
                "pid": os.getpid(),
                "acquired_at": datetime.now(timezone.utc).isoformat(),
            },
            self._source,
            ensure_ascii=False,
        )
        self._source.flush()
        os.fsync(self._source.fileno())

    def close(self) -> None:
        if self._source.closed:
            return
        fcntl.flock(self._source.fileno(), fcntl.LOCK_UN)
        self._source.close()


def _safe_run_name(value: str) -> str:
    raw = str(value)
    safe = "".join(character for character in raw if character.isalnum() or character in "-_")
    if not safe or safe != raw:
        raise ValueError("训练运行名称只能包含字母、数字、连字符和下划线")
    return safe


def _git_output(project_root: Path, *arguments: str) -> str:
    try:
        return subprocess.run(
            ["git", *arguments],
            cwd=project_root,
            check=True,
            capture_output=True,
            text=True,
            timeout=5,
        ).stdout.strip()
    except (FileNotFoundError, subprocess.SubprocessError) as error:
        raise RuntimeError("无法读取训练源码的 Git 状态") from error


def _source_commit(project_root: Path) -> str:
    commit = _git_output(project_root, "rev-parse", "HEAD")
    if len(commit) != 40:
        raise RuntimeError("训练源码没有可识别的 Git 提交")
    dirty = _git_output(project_root, "status", "--porcelain", "--untracked-files=all")
    if dirty:
        raise RuntimeError("训练源码工作区存在未提交改动，请先形成可复现提交")
    return commit


def _config_sha256(config: dict[str, Any]) -> str:
    encoded = json.dumps(
        config,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def _file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _atomic_json(path: Path, value: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary_name = tempfile.mkstemp(
        prefix=f".{path.name}.",
        suffix=".tmp",
        dir=path.parent,
    )
    temporary = Path(temporary_name)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8") as output:
            json.dump(value, output, ensure_ascii=False, indent=2, sort_keys=True)
            output.flush()
            os.fsync(output.fileno())
        os.replace(temporary, path)
    finally:
        if temporary.exists():
            temporary.unlink()


def _directory_has_artifacts(path: Path) -> bool:
    try:
        next(path.iterdir())
    except (FileNotFoundError, StopIteration):
        return False
    return True


def prepare_run_identity(
    *,
    data_root: str | Path,
    run_name: str,
    config: dict[str, Any],
    config_path: str | Path,
    project_root: str | Path,
    resume_path: str | Path | None = None,
    resume_payload: dict[str, Any] | None = None,
) -> RunIdentity:
    """创建新运行清单，或严格验证续训仍对应同一代码与最新检查点。"""
    root = ensure_data_disk_path(data_root)
    safe_run_name = _safe_run_name(run_name)
    project = Path(project_root).resolve()
    commit = _source_commit(project)
    config_digest = _config_sha256(config)
    run_directory = root / "runs" / safe_run_name
    checkpoint_directory = root / "checkpoints" / safe_run_name
    league_directory = root / "league" / safe_run_name
    manifest_path = run_directory / "run.json"

    if resume_path is None:
        if _directory_has_artifacts(checkpoint_directory) or _directory_has_artifacts(
            league_directory,
        ):
            raise FileExistsError(
                f"运行 {safe_run_name} 已有训练产物；请使用 --resume 或更换 run.name",
            )
        run_directory.parent.mkdir(parents=True, exist_ok=True)
        try:
            run_directory.mkdir()
        except FileExistsError as error:
            raise FileExistsError(
                f"运行 {safe_run_name} 已有训练产物；请使用 --resume 或更换 run.name",
            ) from error
        try:
            _atomic_json(
                manifest_path,
                {
                    "schema_version": RUN_MANIFEST_SCHEMA_VERSION,
                    "run_name": safe_run_name,
                    "created_at": datetime.now(timezone.utc).isoformat(),
                    "git_commit": commit,
                    "config_sha256": config_digest,
                    "config_path": str(Path(config_path).resolve()),
                    "seed": int(config["run"]["seed"]),
                },
            )
            lease = RunLease(run_directory / "active.lock")
        except Exception:
            for child in run_directory.iterdir():
                child.unlink()
            run_directory.rmdir()
            raise
        return RunIdentity(commit, config_digest, manifest_path, lease)

    if resume_payload is None:
        raise ValueError("续训必须提供已校验的检查点内容")
    if str(resume_payload.get("run_name")) != safe_run_name:
        raise ValueError("续训检查点与配置中的运行名称不一致")
    checkpoint_commit = str(resume_payload.get("git_commit", "unknown"))
    if checkpoint_commit != commit:
        raise RuntimeError(
            f"续训源码提交不一致：当前 {commit[:12]}，检查点 {checkpoint_commit[:12]}",
        )
    try:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError, OSError) as error:
        raise RuntimeError("续训运行清单缺失或损坏") from error
    if int(manifest.get("schema_version", 0)) != RUN_MANIFEST_SCHEMA_VERSION:
        raise ValueError("续训运行清单版本不兼容")
    if manifest.get("git_commit") != commit or manifest.get("config_sha256") != config_digest:
        raise ValueError("续训运行清单与当前源码或配置不一致")

    latest_path = checkpoint_directory / "latest.json"
    try:
        latest = json.loads(latest_path.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError, OSError) as error:
        raise RuntimeError("续训检查点清单缺失或损坏") from error
    resolved_resume = ensure_data_disk_path(resume_path)
    if resolved_resume != Path(str(latest.get("path", ""))).resolve():
        raise ValueError("只能从该运行的最新检查点续训，以免联赛与指标历史分叉")
    if _file_sha256(resolved_resume) != str(latest.get("sha256", "")):
        raise ValueError("续训检查点 SHA-256 校验失败")
    if int(latest.get("update", -1)) != int(resume_payload.get("update", -2)):
        raise ValueError("续训检查点轮次与最新清单不一致")
    lease = RunLease(run_directory / "active.lock")
    return RunIdentity(commit, config_digest, manifest_path, lease)
