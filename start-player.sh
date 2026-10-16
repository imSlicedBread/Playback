#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
export NODE_ENV=production
export PB_OPEN_BROWSER="${PB_OPEN_BROWSER:-1}"
exec node server.js