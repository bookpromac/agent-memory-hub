# Memory Hub MCP

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

## 架构：一个记忆服务，多种接口

```
智能体（DSH / Claude Code / Codex / 脚本）
        │
   MCP · HTTP · CLI · 文件导入      ← 接口层
        │
     工具契约（mem_*）              ← tools.mjs
        │
   ~/Memory（Markdown + 审计链）    ← 核心
```

**存储只做一次，接口做多种，每个智能体只写一个适配器。** 详见 [docs/FRAMEWORK.md](docs/FRAMEWORK.md)。

## 安装

尚未发布到 npm，直接从源码用（无需 `npm install`）：

```bash
git clone <repo> agent-memory-hub && cd agent-memory-hub
node src/cli.mjs init
```

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

# 4. 看本机有哪些智能体可以接
node src/cli.mjs adapters detect
node src/cli.mjs adapters show dsh      # 打印可直接粘贴的配置片段

# 5. 需要 HTTP 接口时启动守护进程
node src/cli.mjs serve --port 7710
curl -s http://127.0.0.1:7710/health

# 6. 体检 / 审计 / 清理
node src/cli.mjs doctor                    # frontmatter、重复、断链、索引漂移
node src/cli.mjs verify                    # 校验哈希审计链
node src/cli.mjs gc                        # 默认 dry-run，看清了再加 --yes
node src/cli.mjs stats
node src/cli.mjs rebuild
```

从 v1 升级（会自动备份到 `~/Memory/backups/pre-v2-*`）：

```bash
node src/cli.mjs migrate          # 先看有多少条待迁移
node src/cli.mjs migrate --yes    # 真正执行
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

## 审计链

每次写入都会链接上一条：

```
hash_n = sha256(prev_hash + id + created + source.agent + normalized(body))
```

- 任何历史改写都会被 `memhub verify` 发现（`hash-mismatch`）
- 修订不覆盖原条目：旧条目标记 `superseded` 并写 `valid_to`，新条目追加到链尾
- 链只追加，因此可以回答「当时记的是什么、什么时候被谁取代」

```bash
$ memhub verify
{ "ok": true, "checked": 42, "legacy": 0, "problems": [] }
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

每条记忆带 `source.agent`、`confidence`、`created/updated`、`valid_from/valid_to`、`anchors`、`prev_hash/hash`、可选 `links`。

正文中的 `## 观察` 段落会被拆成独立条目建索引，检索时返回**命中的具体观察**，而不是整篇摘要。`anchors` 是 1–3 个检索锚词，用于补中文 trigram 对同义改写不敏感的短板。
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
# ✓ 18 项冒烟测试全部通过
```

CI 在 Node 22 / 24 / 26 三个版本上跑同一套测试。

## 项目状态

见 [ROADMAP.md](ROADMAP.md)。当前 **v0.4**：三接口框架（MCP / HTTP / CLI）+ 7 个智能体适配器 + Schema v2 审计链。

- License: MIT
- 零运行时依赖
- 数据默认在 `~/Memory`，可 `MEMORY_HOME` 覆盖
设计文档见同目录 `../记忆中枢设计方案-2026-11-23.md`。
