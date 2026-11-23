# 框架说明：一个记忆服务，多种接口

本机的智能体不止一个，各自的接入方式不同。本项目的做法是：

> **存储只做一次，接口做多种，每个智能体只写一个适配器。**

---

## 一、分层

```
                 ┌─────────────── 智能体 ───────────────┐
                 │ DSH · Claude Code · Codex · Cursor   │
                 │ 脚本 / cron / 任意 HTTP 客户端         │
                 └───────────────┬──────────────────────┘
                                 │
        ┌────────────────────────┼────────────────────────┐
        │                        │                        │
   ┌────▼─────┐           ┌──────▼──────┐          ┌──────▼─────┐
   │ MCP stdio│           │ HTTP daemon │          │ CLI / 导入  │
   │ mcp.mjs  │           │  http.mjs   │          │  cli.mjs   │
   └────┬─────┘           └──────┬──────┘          └──────┬─────┘
        └────────────── 同一套工具契约 ─────────────────────┘
                            tools.mjs
                                │
                        ┌───────▼────────┐
                        │  store.mjs     │  Markdown + FTS5 + 审计链
                        │  ~/Memory/     │
                        └────────────────┘
```

**关键约束**：`store.mjs` 不知道任何智能体的存在；`tools.mjs` 是唯一的工具契约；接口层只做协议翻译。

## 二、接口矩阵

| 接口 | 适用 | 入口 | 鉴权 |
|---|---|---|---|
| MCP (stdio) | 支持 MCP 的桌面/CLI 智能体 | `src/mcp.mjs` | 本机进程，无需 |
| HTTP | 脚本、自研智能体、跨语言调用 | `memhub serve`（默认 7710） | Bearer token（`~/Memory/.memory/token`） |
| CLI | shell、cron、一次性任务 | `memhub <cmd>` | 本机文件权限 |
| 文件导入 | 只给导出、不给接口的产品 | `memhub import` | — |

HTTP 只监听 `127.0.0.1`，不开局域网端口——这是对之前 8001/18060 暴露事故的直接反应。

## 三、适配器契约

每个智能体一个适配器，定义在 `src/adapters.mjs`：

```js
{
  id: 'dsh',
  name: 'DeepSeek Harness',
  protocol: 'mcp' | 'http' | 'cli' | 'file',
  note: '一句话说明接入方式',
  detect(): string|null,        // 本机是否已安装/已配置，返回关键路径
  setup(ctx): string,           // 返回可直接粘贴的配置片段
}
```

`ctx` 含 `{ memoryHome, port }`，保证片段里的路径随环境变化。

新增一个智能体 = 往 `ADAPTERS` 数组加一项，不需要动存储、不需要动工具、不需要动其他接口。

## 四、当前支持

| id | 智能体 | 协议 | 本机检测 |
|---|---|---|---|
| `dsh` | DeepSeek Harness | MCP | ✅ 已装 |
| `claude-code` | Claude Code / Desktop | MCP | ✅ 已装 |
| `codex` | Codex CLI | MCP | ✅ 已装 |
| `cursor` | Cursor | MCP | ❌ 未装 |
| `http` | 脚本 / 自定义 | HTTP | — |
| `cli` | shell / cron | CLI | — |
| `import` | 只能导出的产品 | 文件 | ✅ 有导出目录 |

```bash
memhub adapters            # 总览
memhub adapters detect     # 只看本机已检测到的
memhub adapters show dsh   # 打印可直接粘贴的配置
```

## 五、接入一个智能体的标准步骤

1. `memhub adapters show <id>` 拿到片段
2. 粘贴到该智能体的配置文件
3. 在这个智能体的指令文件里加一段「记忆约定」（`examples/AGENTS.md.example`）
4. 验证：让它写一条，再用 `memhub search` 查得到

第 3 步最容易被跳过，但**没有它，智能体不会主动读写记忆**。

## 六、HTTP 接口

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/health` | 免鉴权健康检查 |
| GET | `/v1/search?q=&kinds=&limit=` | 检索 |
| GET | `/v1/recent?limit=` | 最近记忆 |
| GET | `/v1/notes/:id` | 读全文 |
| GET | `/v1/audit` | 审计链 |
| POST | `/v1/write` | 写入 |
| POST | `/v1/tools/:name` | 直接调用工具（与 MCP 同名同参） |

## 七、为什么不做成单一大接口

三种场景的约束完全不同：

- MCP 客户端要求 **stdio、长连接、JSON-RPC**；
- 脚本要求 **一条 curl 就能用**；
- 导入要求 **能处理大文件、可断点**。

硬塞进一个接口会同时得罪三种调用方。**接口分裂、语义统一**（同一个 `mem_write`）是唯一合理的解法。

## 八、下一步

1. 逐个接通本机已检测到的智能体（dsh → claude-code → codex → import）
2. 每个接通后记录：验证命令、写入的记忆 id、遇到的问题
3. 接通三个之后再看是否需要为某些产品写专用导入器（如 DeepSeek / 豆包导出格式）
