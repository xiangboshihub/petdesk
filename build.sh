#!/bin/zsh
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
BUILD_DIR="$ROOT_DIR/build"
HELPER_BIN="$BUILD_DIR/key-monitor"

mkdir -p "$BUILD_DIR"
rm -f "$HELPER_BIN"
rm -f "$BUILD_DIR/PetClawCatTyper"
rm -rf "$BUILD_DIR/PetClawCatTyper.app"

clang \
  -fobjc-arc \
  -framework Cocoa \
  -framework ApplicationServices \
  -o "$HELPER_BIN" \
  "$ROOT_DIR/Sources/PetClawCatTyper/key-monitor.m"

if [ ! -d "$ROOT_DIR/node_modules/electron" ]; then
  npm install
fi

echo "Built helper: $HELPER_BIN"
