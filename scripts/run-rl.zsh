#!/bin/zsh
set -euo pipefail

PROJECT_ROOT="${0:A:h:h}"
RL_DATA_ROOT="${HARUHI_RL_DATA_ROOT:-/Volumes/data/haruhi-rl}"

if [[ "$RL_DATA_ROOT" != /Volumes/data/* ]]; then
  print -u2 "拒绝运行：强化学习目录必须位于 /Volumes/data，当前为 $RL_DATA_ROOT"
  exit 1
fi

if ! command -v uv >/dev/null 2>&1; then
  print -u2 "未找到 uv；请先运行 scripts/setup-rl-runtime.zsh"
  exit 1
fi

if [[ ! -x "$RL_DATA_ROOT/venv/bin/python" ]]; then
  print -u2 "数据盘训练环境不存在；请先运行 scripts/setup-rl-runtime.zsh"
  exit 1
fi

export UV_CACHE_DIR="$RL_DATA_ROOT/cache/uv"
export UV_PYTHON_INSTALL_DIR="$RL_DATA_ROOT/python"
export UV_PROJECT_ENVIRONMENT="$RL_DATA_ROOT/venv"
export PIP_CACHE_DIR="$RL_DATA_ROOT/cache/pip"
export TORCH_HOME="$RL_DATA_ROOT/cache/torch"
export XDG_CACHE_HOME="$RL_DATA_ROOT/cache/xdg"
export TMPDIR="$RL_DATA_ROOT/tmp"
export PYTHONPATH="$PROJECT_ROOT/training/src${PYTHONPATH:+:$PYTHONPATH}"

exec uv run --project "$PROJECT_ROOT/training" --locked --no-sync "$@"
