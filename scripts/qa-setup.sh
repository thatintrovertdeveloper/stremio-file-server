#!/usr/bin/env bash
# One-time local dependency install for the QA checks.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "==> file-server: pinned Python deps in .venv"
python3 -m venv "$ROOT/file-server/.venv"
"$ROOT/file-server/.venv/bin/pip" install -q --upgrade pip
"$ROOT/file-server/.venv/bin/pip" install -q -r "$ROOT/file-server/requirements.txt"

echo "==> addon: npm ci"
(cd "$ROOT/addon" && npm ci --no-audit --no-fund)

echo "==> fixtures"
bash "$ROOT/scripts/qa-fixtures.sh"

echo "ready: run scripts/qa-e2e.sh (or: node .skills/qa-skills/scripts/qa.mjs run --project $ROOT)"
