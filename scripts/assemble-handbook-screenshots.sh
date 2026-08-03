#!/usr/bin/env bash
#
# Assemble handbook screenshots from Playwright chromium-linux visual
# baselines under e2e/*.spec.ts-snapshots/. The flat `<name>.png` output
# layout matches what public/handbook/index.html links to
# (`/handbook/screenshots/<name>.png`).
#
# Usage:
#   scripts/assemble-handbook-screenshots.sh <output-dir>
#
# Used by:
#   - Dockerfile.handbook (multi-stage build → /usr/share/nginx/html/screenshots/)
#   - local package script `handbook:assemble`
#
# Source of truth for every handbook image is one committed baseline PNG.
# When a new snap() name is added, append a row here AND reference it from
# public/handbook/index.html — never source a screenshot from anywhere else.

set -euo pipefail

if [ "$#" -ne 1 ]; then
  echo "usage: $0 <output-dir>" >&2
  exit 2
fi

OUT="$1"
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

mkdir -p "$OUT"

# handbook-name → relative path from repo root to the chromium-linux baseline.
# Keep this list in exact sync with every snap(page, name, ...) call in e2e/.
MAPPING=(
  "01-home-desktop=e2e/01-public-home.spec.ts-snapshots/01-home-desktop-chromium-linux.png"
  "01-home-loaded-more=e2e/01-public-home.spec.ts-snapshots/01-home-loaded-more-chromium-linux.png"
  "01-home-empty=e2e/01-public-home.spec.ts-snapshots/01-home-empty-chromium-linux.png"
  "01-home-mobile=e2e/01-public-home.spec.ts-snapshots/01-home-mobile-chromium-linux.png"
  "02-accumulator-desktop=e2e/02-accumulator.spec.ts-snapshots/02-accumulator-desktop-chromium-linux.png"
  "03-tx-empty=e2e/03-tx-link-default.spec.ts-snapshots/03-tx-empty-chromium-linux.png"
  "03-tx-malformed=e2e/03-tx-link-default.spec.ts-snapshots/03-tx-malformed-chromium-linux.png"
  "04-nullifier-present=e2e/04-nullifier-lookup.spec.ts-snapshots/04-nullifier-present-chromium-linux.png"
  "04-nullifier-absent=e2e/04-nullifier-lookup.spec.ts-snapshots/04-nullifier-absent-chromium-linux.png"
  "04-nullifier-invalid-input=e2e/04-nullifier-lookup.spec.ts-snapshots/04-nullifier-invalid-input-chromium-linux.png"
  "05-balance-empty=e2e/05-balance-link.spec.ts-snapshots/05-balance-empty-chromium-linux.png"
  "05-balance-authorised=e2e/05-balance-link.spec.ts-snapshots/05-balance-authorised-chromium-linux.png"
  "06-addr-empty=e2e/06-addr-link.spec.ts-snapshots/06-addr-empty-chromium-linux.png"
  "06-addr-incoming-only=e2e/06-addr-link.spec.ts-snapshots/06-addr-incoming-only-chromium-linux.png"
  "06-addr-full-mode=e2e/06-addr-link.spec.ts-snapshots/06-addr-full-mode-chromium-linux.png"
  "07-tx-authorised=e2e/07-bearer-authorised-vs-unauthorised.spec.ts-snapshots/07-tx-authorised-chromium-linux.png"
  "07-tx-unauthorised=e2e/07-bearer-authorised-vs-unauthorised.spec.ts-snapshots/07-tx-unauthorised-chromium-linux.png"
  "08-error-state=e2e/08-error-state.spec.ts-snapshots/08-error-state-chromium-linux.png"
  "09-loading-state=e2e/09-loading-state.spec.ts-snapshots/09-loading-state-chromium-linux.png"
  "10-nav-shell-desktop=e2e/10-nav-shell-a11y.spec.ts-snapshots/10-nav-shell-desktop-chromium-linux.png"
  "10-nav-shell-mobile=e2e/10-nav-shell-a11y.spec.ts-snapshots/10-nav-shell-mobile-chromium-linux.png"
)

missing=()
copied=0
for entry in "${MAPPING[@]}"; do
  name="${entry%%=*}"
  src_rel="${entry#*=}"
  src="$REPO_ROOT/$src_rel"
  if [ ! -f "$src" ]; then
    missing+=("$name → $src_rel")
    continue
  fi
  cp "$src" "$OUT/$name.png"
  copied=$((copied + 1))
done

if [ "${#missing[@]}" -gt 0 ]; then
  echo "error: handbook-screenshot sources missing from e2e snapshots:" >&2
  printf '  %s\n' "${missing[@]}" >&2
  echo >&2
  echo "Run the visual-regression suite with --update-snapshots and commit" >&2
  echo "baselines, or update the mapping in $0 to point at an existing PNG." >&2
  exit 1
fi

echo "assemble-handbook-screenshots: assembled ${copied} screenshot(s) into ${OUT}"
