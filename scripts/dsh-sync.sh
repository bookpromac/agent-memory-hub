#!/bin/bash
# 由 launchd 定时调用：刷新摘要并沉淀新会话
set -u
REPO="/Users/macbookpro/Documents/deepseek-harness/default-workspace/agent-memory-hub"
WORK="/Users/macbookpro/Documents/deepseek-harness/default-workspace"
export MEMORY_HOME="/Users/macbookpro/Memory"
LOG="$MEMORY_HOME/.memory/sync.log"
mkdir -p "$(dirname "$LOG")"
cd "$WORK" || exit 1
{
  echo "=== $(date '+%F %T') dsh sync ==="
  node "$REPO/src/cli.mjs" dsh sync --min-age 30
  node "$REPO/src/cli.mjs" verify | tail -3
} >> "$LOG" 2>&1
tail -200 "$LOG" > "$LOG.tmp" && mv "$LOG.tmp" "$LOG"
