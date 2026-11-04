#!/usr/bin/env bash
# Prepare McBot's own Hermes (hermes/): Hermes' package manager fetches its pinned
# Python, uv, Node and tools into hermes/.hermes-runtime and installs the locked
# dependencies. Run once after cloning, and after a Hermes update.
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export HERMES_RUNTIME_DIR="${HERMES_RUNTIME_DIR:-$here/hermes/.hermes-runtime}"
bash "$here/hermes/setup-hermes.sh" --runtime-only
bash "$here/hermes/scripts/run-in-hermes-env" python3 "$here/hermes/hermes" --version
