#!/bin/zsh
set -euo pipefail

PROJECT_ROOT="${0:A:h:h}"
exec "$PROJECT_ROOT/scripts/run-rl.zsh" python -m haruhi_rl.monitor "$@"
