#!/usr/bin/env bash
# McBot's own Hermes from a terminal, on McBot's agents: `npm run cli -- -p <agent>`.
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export HERMES_RUNTIME_DIR="${HERMES_RUNTIME_DIR:-$here/hermes/.hermes-runtime}"
# `hermes update` here says Hermes updates arrive with McBot (hermes_constants.py get_managed_system).
export HERMES_MANAGED=mcbot
export HERMES_HOME="${HERMES_HOME:-${MCBOT_WORKSPACE:-$HOME/McBot}/hermes}"
exec bash "$here/hermes/scripts/run-in-hermes-env" python3 "$here/hermes/hermes" "$@"
