#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

[[ -x ./scripts/bootstrap.sh ]] || {
  echo "ERROR: scripts/bootstrap.sh is not executable"
  exit 1
}

./scripts/bootstrap.sh >/dev/null

for dir in src tests docs; do
  [[ -d "$dir" ]] || {
    echo "ERROR: missing directory $dir"
    exit 1
  }
  [[ -f "$dir/.gitkeep" ]] || {
    echo "ERROR: missing $dir/.gitkeep"
    exit 1
  }
done

[[ -f .env.example ]] || {
  echo "ERROR: missing .env.example"
  exit 1
}

echo "All checks passed"
