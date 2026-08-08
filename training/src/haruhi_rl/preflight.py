"""在加载 PyTorch 前执行的轻量训练资源预检。"""

from __future__ import annotations

import argparse
import json

from .resources import GIB, evaluate_resource_safety, read_resource_snapshot


def main() -> int:
    parser = argparse.ArgumentParser(description="检查强化学习训练资源余量")
    parser.add_argument("--data-root", default="/Volumes/data/haruhi-rl")
    args = parser.parse_args()
    snapshot = read_resource_snapshot(args.data_root)
    decision = evaluate_resource_safety(snapshot)
    print(json.dumps({
        "allowed": decision.allowed,
        "system_free_gib": round(snapshot.system_free_bytes / GIB, 3),
        "data_free_gib": round(snapshot.data_free_bytes / GIB, 3),
        "swap_free_gib": None if snapshot.swap_free_bytes is None else round(snapshot.swap_free_bytes / GIB, 3),
        "process_rss_gib": round(snapshot.process_rss_bytes / GIB, 3),
        "reasons": list(decision.reasons),
    }, ensure_ascii=False))
    return 0 if decision.allowed else 75


if __name__ == "__main__":
    raise SystemExit(main())
