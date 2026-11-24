#!/usr/bin/env bash
# 將 adapters/*.js（單一事實來源）複製成 GAS 可載入的 .gs。修改 adapters 後必須執行。
set -euo pipefail
cd "$(dirname "$0")/.."
for f in health-adapter dashboard-service; do
  { echo "// AUTO-GENERATED from adapters/$f.js by scripts/sync-gas.sh — DO NOT EDIT HERE"; cat "adapters/$f.js"; } > "gas/dashboard/$f.gs"
done
echo "synced -> gas/dashboard/"
