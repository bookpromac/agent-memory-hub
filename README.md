# Agent Memory Hub

> 一个智能体的记忆，所有智能体都能用。

跨 agent 的长期记忆层：**Markdown 是事实源，MCP 是协议，任何模型都能读写**。
零外部依赖（Node ≥22.5 内置 `node:sqlite`），数据全部留在本机。

```
┌──────────────┐  ┌──────────────┐  ┌──────────────┐
│ DeepSeek     │  │ Claude Code  │  │ Codex/Cursor │   ← 任意 MCP 客户端
│ Harness      │  │              │  │              │
└──────┬───────┘  └──────┬───────┘  └──────┬───────┘
       └─────────────────┼─────────────────┘
                    MCP (stdio)
                         │
                  ┌──────▼───────┐
                  │   memhub     │  6 个工具
                  └──────┬───────┘
                         │
              ┌──────────▼──────────┐
              │  ~/Memory/          │
              │  memories/*.md  ← 事实源
              │  index.sqlite   ← 可重建索引
              └─────────────────────┘
```

## 为什么不用现成的

| 现成方案 | 问题 |
|---|---|
| MCP 官方 memory server | 单 JSON 存图，无 Markdown、无版本、无中文分词 |
| Mem0 | 记忆变成不可读向量，无法人工审阅与版本化 |
| Basic Memory | 最接近，但 AGPL + 外部依赖 |
| Zep/Graphiti | 社区版已停维护 |

本项目的取舍：**可读、可改、可版本化、可重建**，牺牲的是自动提取与语义检索。

## 快速开始

```bash
# 1. 初始化（默认 ~/Memory，可用 MEMORY_HOME 覆盖）
node src/cli.mjs init

# 2. 写一条记忆
node src/cli.mjs write \
  --kind decisions \
  --title "只保留 DeepSeek Harness 一个智能体" \
  --confidence high --agent deepseek-harness --session 440a6d9b \
  --tags agent,consolidation \
  --body "## 结论
本机只保留 DSH 一个 agent 框架。"

# 3. 中文检索（FTS5 trigram，≥3 字走全文索引）
node src/cli.mjs search "智能体" --limit 5

# 4. 统计 / 重建索引
node src/cli.mjs stats
node src/cli.mjs rebuild
```

## 接入任意 MCP 客户端

### DeepSeek Harness

创建一个配置式 bundle（`dsh-mcp-client`，stdio）：

```yaml
- id: memory-hub
  name: "@deepseek-ai/dsh-mcp-client"
  config:
    serverName: memory
    transport: stdio
    command: node
    args: ["/Users/你/Documents/.../agent-memory-hub/src/mcp.mjs"]
    failOnStartupError: true
```

### Claude Code / Claude Desktop

```json
{
  "mcpServers": {
    "memory": {
      "command": "node",
      "args": ["/Users/你/.../agent-memory-hub/src/mcp.mjs"]
    }
  }
}
```

### Codex / 其他

任何支持 stdio MCP 的客户端，配置 `command: node`、`args: [.../src/mcp.mjs]` 即可。

### 关键：让 agent 真的去读

在 `AGENTS.md` / `CLAUDE.md` 里加一段（三个 agent 用同一份文本）：

```markdown
## 记忆
你有长期记忆，存放在 ~/Memory，通过 mem_* 工具访问。
- 开始非平凡任务前：mem_search("<关键词>")
- 结束时把可复用结论用 mem_write 写入，source_agent 必填
- 绝不写入密码或密钥
```

## 记忆模型

五类记忆，强制出处与置信度：

| kind | 用途 | 例子 |
|---|---|---|
| `facts` | 稳定事实 | 机器型号、路径、账号归属 |
| `preferences` | 偏好 | 中文、简洁、不用表情 |
| `entities` | 人/项目/系统 | DSH 是什么、谁负责 |
| `decisions` | 决策 | 结论 + 理由 + 备选 + 影响 |
| `episodes` | 事件结论 | 某次故障的根因 |

每条记忆带 `source.agent`、`confidence`、`created/updated`、可选 `links`。
**没有出处的记忆不可信**——这是把它和其他记忆库区分开的设计约束。

## 工具清单

| 工具 | 说明 |
|---|---|
| `mem_search` | 检索，返回摘要（不是全文），中文≥3 字走 FTS5 |
| `mem_get` | 读全文 |
| `mem_write` | 写入；必填 `source_agent`；疑似密钥直接拒绝 |
| `mem_revise` | 修订；旧版存 `revisions/` |
| `mem_recent` | 最近更新，会话开场对齐 |
| `mem_forget` | 墓碑，不物理删除 |

Resources：`memory://recent`、`memory://index`。

## 测试

```bash
node test/smoke.mjs
# ✓ 12 项冒烟测试全部通过
```

## 项目状态

见 [ROADMAP.md](ROADMAP.md)。当前 **v0.1 — P0/P1 完成**：存储、索引、CLI、MCP server、冒烟测试可用。
设计文档见同目录 `../记忆中枢设计方案-2026-11-23.md`。
