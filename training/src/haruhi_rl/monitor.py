"""输出不加载模型的训练状态快照。"""

from __future__ import annotations

import argparse
import json

from .run_status import collect_run_status


def main() -> int:
    parser = argparse.ArgumentParser(description="查看强化学习训练状态")
    parser.add_argument("--data-root", default="/Volumes/data/haruhi-rl")
    parser.add_argument("--run", default="universal-v0")
    parser.add_argument("--stale-after", type=float, default=600)
    args = parser.parse_args()
    status = collect_run_status(
        args.data_root,
        args.run,
        stale_after_seconds=args.stale_after,
    )
    print(json.dumps(status, ensure_ascii=False, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
