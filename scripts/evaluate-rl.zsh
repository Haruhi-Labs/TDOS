#!/bin/zsh
set -euo pipefail

PROJECT_ROOT="${0:A:h:h}"
RL_DATA_ROOT="${HARUHI_RL_DATA_ROOT:-/Volumes/data/haruhi-rl}"

"$PROJECT_ROOT/scripts/run-rl.zsh" python -m haruhi_rl.preflight --data-root "$RL_DATA_ROOT"
exec "$PROJECT_ROOT/scripts/run-rl.zsh" python -m haruhi_rl.benchmark "$@"
