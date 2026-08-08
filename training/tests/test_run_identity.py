from __future__ import annotations

import hashlib
import json
from pathlib import Path
import subprocess
import tempfile

import pytest

from haruhi_rl.run_identity import RunLease, prepare_run_identity

DATA_TMP = Path("/Volumes/data/haruhi-rl/tmp")


def git(root: Path, *arguments: str) -> str:
    return subprocess.run(
        ["git", *arguments],
        cwd=root,
        check=True,
        capture_output=True,
        text=True,
    ).stdout.strip()


def clean_repository(root: Path) -> str:
    git(root, "init", "-q")
    source = root / "source.txt"
    source.write_text("初始源码", encoding="utf-8")
    git(root, "add", "source.txt")
    git(
        root,
        "-c",
        "user.name=训练测试",
        "-c",
        "user.email=training@example.invalid",
        "commit",
        "-q",
        "-m",
        "初始提交",
    )
    return git(root, "rev-parse", "HEAD")


def config(name: str) -> dict:
    return {"run": {"name": name, "seed": 7}, "ppo": {"learning_rate": 5e-5}}


def test_run_lease_blocks_concurrent_process_and_can_be_reacquired() -> None:
    DATA_TMP.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="lease-test-", dir=DATA_TMP) as temporary:
        path = Path(temporary) / "active.lock"
        first = RunLease(path)
        with pytest.raises(RuntimeError, match="已有活动进程"):
            RunLease(path)
        first.close()
        second = RunLease(path)
        second.close()


def test_new_run_records_identity_and_rejects_reuse() -> None:
    DATA_TMP.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="identity-test-", dir=DATA_TMP) as temporary:
        root = Path(temporary)
        project = root / "project"
        data = root / "data"
        project.mkdir()
        data.mkdir()
        commit = clean_repository(project)
        current = config("new-run")
        identity = prepare_run_identity(
            data_root=data,
            run_name="new-run",
            config=current,
            config_path=project / "config.yaml",
            project_root=project,
        )
        manifest = json.loads(identity.manifest_path.read_text(encoding="utf-8"))
        assert identity.git_commit == commit
        assert manifest["git_commit"] == commit
        assert manifest["config_sha256"] == identity.config_sha256
        identity.close()

        with pytest.raises(FileExistsError, match="已有训练产物"):
            prepare_run_identity(
                data_root=data,
                run_name="new-run",
                config=current,
                config_path=project / "config.yaml",
                project_root=project,
            )


def test_resume_requires_clean_matching_source_and_latest_checkpoint() -> None:
    DATA_TMP.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="resume-test-", dir=DATA_TMP) as temporary:
        root = Path(temporary)
        project = root / "project"
        data = root / "data"
        project.mkdir()
        data.mkdir()
        commit = clean_repository(project)
        current = config("resume-run")
        initial = prepare_run_identity(
            data_root=data,
            run_name="resume-run",
            config=current,
            config_path=project / "config.yaml",
            project_root=project,
        )
        initial.close()
        checkpoint = data / "checkpoints" / "resume-run" / "update_000003.pt"
        checkpoint.parent.mkdir(parents=True)
        checkpoint.write_bytes(b"checkpoint")
        digest = hashlib.sha256(checkpoint.read_bytes()).hexdigest()
        (checkpoint.parent / "latest.json").write_text(
            json.dumps({"path": str(checkpoint), "sha256": digest, "update": 3}),
            encoding="utf-8",
        )
        payload = {"run_name": "resume-run", "git_commit": commit, "update": 3}
        resumed = prepare_run_identity(
            data_root=data,
            run_name="resume-run",
            config=current,
            config_path=project / "config.yaml",
            project_root=project,
            resume_path=checkpoint,
            resume_payload=payload,
        )
        assert resumed.git_commit == commit
        resumed.close()

        (project / "source.txt").write_text("未提交改动", encoding="utf-8")
        with pytest.raises(RuntimeError, match="未提交改动"):
            prepare_run_identity(
                data_root=data,
                run_name="resume-run",
                config=current,
                config_path=project / "config.yaml",
                project_root=project,
                resume_path=checkpoint,
                resume_payload=payload,
            )
