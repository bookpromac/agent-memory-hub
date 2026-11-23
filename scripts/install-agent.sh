#!/bin/bash
# 把运行副本同步到 ~/.local/share/memory-hub 并重载 launchd 任务
# 原因：launchd 进程受 TCC 限制，不能读取 ~/Documents
set -eu
SRC="$(cd "$(dirname "$0")/.." && pwd)"
DEST="$HOME/.local/share/memory-hub"
mkdir -p "$DEST"
rsync -a --delete "$SRC/src/" "$DEST/src/"
cp "$SRC/package.json" "$DEST/"
cp "$SRC/scripts/dsh-sync.sh" "$DEST/dsh-sync.sh"
chmod +x "$DEST/dsh-sync.sh"
launchctl bootout gui/$(id -u)/com.local.memory-hub.dsh-sync 2>/dev/null || true
launchctl bootstrap gui/$(id -u) "$HOME/Library/LaunchAgents/com.local.memory-hub.dsh-sync.plist"
echo "已安装到 $DEST 并重载 com.local.memory-hub.dsh-sync"
