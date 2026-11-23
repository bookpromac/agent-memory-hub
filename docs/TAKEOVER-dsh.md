# DSH 记忆接管方案

## 目标

DSH 的记忆不再是"会话结束后就沉在日志里"，而是：
1. **每次会话必读摘要**（不依赖模型自觉去调工具）
2. **会话内容自动沉淀**为可检索记忆
3. **写入有出处、可审计**

## 三条链路

| 链路 | 机制 | 频率 |
|---|---|---|
| 注入 | 工作区 `AGENTS.md` 里的指针块，要求先读 `~/Memory/DIGEST.md` | 每次会话（DSH 自动加载 AGENTS.md） |
| 摘要 | `memhub dsh sync` 重新生成 `DIGEST.md` | 每 6 小时 + 手动 |
| 沉淀 | 解析 `~/.dsh/sessions/**/*.jsonl.zstd`，每个会话一条 episode，变化时修订 | 每 6 小时 |

## 为什么摘要不直接嵌进 AGENTS.md

试过，也生效了——但有两个问题：

1. **会过期**：AGENTS.md 是静态文件，摘要嵌进去后不会自动刷新，反而误导模型。
2. **launchd 写不了**：`~/Documents` 受 TCC 保护，launchd 进程访问会被挂起/拒绝（实测 `Operation not permitted`）。

所以改成**稳定指针**：AGENTS.md 只写"先读 DIGEST.md"，DIGEST.md 由定时任务刷新。指针永不过期。

## 定时任务

```
~/Library/LaunchAgents/com.local.memory-hub.dsh-sync.plist
   -> /bin/bash ~/.local/share/memory-hub/dsh-sync.sh
        -> node .../src/cli.mjs dsh sync --no-embed --min-age 30
        -> node .../src/cli.mjs verify
```

- 运行副本在 `~/.local/share/memory-hub`（TCC 之外）
- 仓库代码改动后执行 `scripts/install-agent.sh` 重新部署
- 日志：`~/Memory/.memory/sync.log`
- 间隔：6 小时；`RunAtLoad` 立即跑一次

## 会话沉淀规则

- 每个 DSH 会话 → 一条 `episodes` 记忆，`confidence: low`
- 标题取第一条用户消息
- 只保留最后 30 条消息、每条截断 220 字、总长 ≤ 6000 字
- 会话更新时**修订**（旧版 superseded，可追溯）
- 最近 30 分钟内仍在活动的会话跳过（`--min-age 30`）

## 验证

```bash
memhub v  # 不存在
node src/cli.mjs verify          # 链完整
node src/cli.mjs stats           # episodes 数量
tail -5 ~/Memory/.memory/sync.log
```

## 关闭

```bash
launchctl bootout gui/$(id -u)/com.local.memory-hub.dsh-sync
rm ~/Library/LaunchAgents/com.local.memory-hub.dsh-sync.plist
```
