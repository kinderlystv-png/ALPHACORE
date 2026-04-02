#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

create_dir_with_keep() {
  local dir="$1"
  mkdir -p "$dir"
  if [[ ! -f "$dir/.gitkeep" ]]; then
    : > "$dir/.gitkeep"
  fi
}

create_dir_with_keep "src"
create_dir_with_keep "tests"
create_dir_with_keep "docs"

if [[ ! -f .env.example ]]; then
  cat > .env.example <<'ENVEOF'
# Example environment variables
APP_ENV=development
ENVEOF
fi

echo "Bootstrap complete"
echo "- ensured directories: src/, tests/, docs/"
echo "- ensured keep files: src/.gitkeep, tests/.gitkeep, docs/.gitkeep"
echo "- ensured .env.example"
