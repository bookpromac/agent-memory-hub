#!/bin/bash
# 由 launchd 定时调用：刷新摘要 + 沉淀会话（只动 ~/Memory 与 ~/.dsh，避开 TCC）
set -u
HUB="$HOME/.local/share/memory-hub"
export MEMORY_HOME="$HOME/Memory"
export MEMORY_AGENT="deepseek-harness"
LOG="$MEMORY_HOME/.memory/sync.log"
mkdir -p "$(dirname "$LOG")"
{
  echo "=== $(date '+%F %T') dsh sync ==="
  /opt/homebrew/bin/node "$HUB/src/cli.mjs" dsh sync --no-embed --min-age 30
  /opt/homebrew/bin/node "$HUB/src/cli.mjs" verify | tail -3
} >> "$LOG" 2>&1
tail -200 "$LOG" > "$LOG.tmp" && mv "$LOG.tmp" "$LOG"
