#!/bin/zsh
set -euo pipefail

script_dir="${0:A:h}"
repo_root="${script_dir:h}"
rl_root="${HARUHI_RL_ROOT:-/Volumes/data/haruhi-rl}"

if [[ "$rl_root" != /Volumes/data/* ]]; then
  print -u2 "训练根目录必须位于数据盘：$rl_root"
  exit 2
fi

if ! command -v uv >/dev/null 2>&1; then
  print -u2 "未找到 uv；为避免写入系统盘，本脚本不会自动使用其他安装器。"
  exit 3
fi

mkdir -p \
  "$rl_root/python" \
  "$rl_root/venv" \
  "$rl_root/cache/uv" \
  "$rl_root/cache/pip" \
  "$rl_root/cache/torch" \
  "$rl_root/cache/xdg" \
  "$rl_root/tmp" \
  "$rl_root/datasets" \
  "$rl_root/runs" \
  "$rl_root/checkpoints" \
  "$rl_root/league" \
  "$rl_root/models"

export UV_CACHE_DIR="$rl_root/cache/uv"
export UV_PYTHON_INSTALL_DIR="$rl_root/python"
export UV_PROJECT_ENVIRONMENT="$rl_root/venv"
export PIP_CACHE_DIR="$rl_root/cache/pip"
export TORCH_HOME="$rl_root/cache/torch"
export XDG_CACHE_HOME="$rl_root/cache/xdg"
export TMPDIR="$rl_root/tmp"

uv python install 3.12
python_path="$(uv python find --managed-python --no-project 3.12)"
uv sync \
  --project "$repo_root/training" \
  --python "$python_path" \
  --locked

"$rl_root/venv/bin/python" - <<'PY'
import json
import platform

import torch

print(json.dumps({
    "python": platform.python_version(),
    "machine": platform.machine(),
    "torch": torch.__version__,
    "mps_available": torch.backends.mps.is_available(),
}, ensure_ascii=False))
PY

print "训练运行时已安装到 $rl_root"
