#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_PATH="$ROOT_DIR/modal_app/video/app.py"

if ! command -v modal >/dev/null 2>&1; then
  echo "Modal CLI is not installed. Install it with: pip install modal"
  exit 1
fi

MODE="${1:-deploy}"

case "$MODE" in
  deploy)
    modal deploy "$APP_PATH"
    ;;
  serve)
    modal serve "$APP_PATH"
    ;;
  *)
    echo "Usage: $0 [deploy|serve]"
    exit 1
    ;;
esac
