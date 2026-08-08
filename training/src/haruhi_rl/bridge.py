"""与 Node 权威战斗批环境通信的同步 NDJSON 桥。"""

from __future__ import annotations

import json
import selectors
import subprocess
from pathlib import Path
from typing import Any


class NodeBatchBridge:
    """启动一个本地 Node 批环境进程，并以单请求/单响应方式推进。"""

    def __init__(
        self,
        project_root: str | Path,
        *,
        count: int,
        base_seed: int,
        decision_ticks: int = 3,
        max_episode_seconds: float = 180,
        stream_offset: int = 0,
        timeout_seconds: float = 30,
        node_executable: str = "node",
        kind: str = "training",
    ) -> None:
        self.project_root = Path(project_root).resolve()
        server = self.project_root / "training" / "js" / "batch-server.mjs"
        if not server.is_file():
            raise FileNotFoundError(f"找不到批环境服务脚本：{server}")
        self.timeout_seconds = max(0.1, float(timeout_seconds))
        self._request_id = 0
        self._process = subprocess.Popen(
            [node_executable, str(server)],
            cwd=self.project_root,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            encoding="utf-8",
            bufsize=1,
        )
        try:
            result = self.request(
                "init",
                {
                    "count": int(count),
                    "baseSeed": int(base_seed),
                    "decisionTicks": int(decision_ticks),
                    "maxEpisodeSeconds": float(max_episode_seconds),
                    "streamOffset": int(stream_offset),
                    "kind": str(kind),
                },
            )
            self.count = int(result["count"])
        except BaseException:
            self.close(force=True)
            raise

    @property
    def alive(self) -> bool:
        return self._process.poll() is None

    def request(self, command: str, payload: dict[str, Any] | None = None) -> Any:
        if not self.alive:
            stderr = self._read_stderr()
            raise RuntimeError(f"批环境进程已经退出：{stderr or '无错误输出'}")
        if self._process.stdin is None or self._process.stdout is None:
            raise RuntimeError("批环境管道不可用")
        self._request_id += 1
        request_id = self._request_id
        message = {
            "id": request_id,
            "command": str(command),
            "payload": payload or {},
        }
        self._process.stdin.write(json.dumps(message, ensure_ascii=False, separators=(",", ":")) + "\n")
        self._process.stdin.flush()

        selector = selectors.DefaultSelector()
        try:
            selector.register(self._process.stdout, selectors.EVENT_READ)
            if not selector.select(self.timeout_seconds):
                raise TimeoutError(f"批环境命令 {command} 在 {self.timeout_seconds:g} 秒内没有响应")
            line = self._process.stdout.readline()
        finally:
            selector.close()
        if not line:
            stderr = self._read_stderr()
            raise RuntimeError(f"批环境在响应 {command} 时关闭：{stderr or '无错误输出'}")
        response = json.loads(line)
        if response.get("id") != request_id:
            raise RuntimeError(f"批环境响应序号错误：期望 {request_id}，实际 {response.get('id')}")
        if not response.get("ok"):
            raise RuntimeError(f"批环境拒绝命令 {command}：{response.get('error', '未知错误')}")
        return response.get("result")

    def reset(self, options: list[dict[str, Any]] | None = None) -> list[dict[str, Any]]:
        return self.request("reset", {"options": options or []})

    def reset_at(self, index: int, options: dict[str, Any] | None = None) -> dict[str, Any]:
        return self.request("reset_at", {"index": int(index), "options": options or {}})

    def step(self, actions: list[dict[str, Any]]) -> list[dict[str, Any]]:
        if len(actions) != self.count:
            raise ValueError(f"批动作数量应为 {self.count}，实际为 {len(actions)}")
        return self.request("step", {"actions": actions})

    def _read_stderr(self) -> str:
        if self._process.stderr is None or self.alive:
            return ""
        return self._process.stderr.read().strip()

    def close(self, *, force: bool = False) -> None:
        if not hasattr(self, "_process") or self._process.poll() is not None:
            return
        if not force:
            try:
                self.request("close")
            except (OSError, RuntimeError, TimeoutError):
                force = True
        if self._process.stdin is not None:
            self._process.stdin.close()
        try:
            self._process.wait(timeout=2)
        except subprocess.TimeoutExpired:
            force = True
        if force and self._process.poll() is None:
            self._process.terminate()
            try:
                self._process.wait(timeout=2)
            except subprocess.TimeoutExpired:
                self._process.kill()
                self._process.wait(timeout=2)

    def __enter__(self) -> NodeBatchBridge:
        return self

    def __exit__(self, _type: object, _value: object, _traceback: object) -> None:
        self.close()
