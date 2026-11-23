# DSH 接入验证清单（已通过 ✅）

> 实测时间：2026-11-23 11:20 · 应用重启后

## 前置

- 已写入 `~/.dsh/profiles/desktop/cordis.patch.yml`，追加 `memory-hub` 行
- 已在工作区根放 `AGENTS.md`（已生效，会作为 workspace 指令注入）
- `~/Memory/DIGEST.md` 已生成

## 重启应用（必需）

新增插件行不会热加载，必须重启 DeepSeek Harness。
本会话会关闭，重新打开同一会话即可（历史保留）。

## 实测结果

| 检查 | 结果 |
|---|---|
| `mcp__memory__*` 6 个工具注册 | ✅ |
| CLI 写 → MCP 搜到 | ✅ `01M84255…` |
| MCP 写 → CLI 搜到 | ✅ `01M8425A…` |
| resources 读取（`memory://audit`） | ✅ 返回 4 条链 |
| 审计链 `verify` | ✅ checked=4, ok=true |

## 两个已踩的坑

1. **新增行必须包在 `- insert:` 里**。顶层行只能覆盖已有 id；写成顶层行会被 Loader **静默忽略**（不报错，只是不生效）。第一次就踩了这个。
2. **新增插件行不会热加载**。HMR 只对已有行的配置生效，必须重启应用。

## 重启后的三步验证

### 1. 工具是否注册

让 agent 调用工具，或直接看工具目录：

- 期望出现 `mcp__memory__mem_search` / `mcp__memory__mem_get` / `mcp__memory__mem_write` / `mcp__memory__mem_recent` / `mcp__memory__mem_revise` / `mcp__memory__mem_forget`

### 2. 读取（跨进程）

```bash
# CLI 侧写入
memhub write --kind facts --title "验证用" --agent cli-test \
  --body "## 结论\n这条是 CLI 写入的，用于验证跨接口。"
```

然后让 agent 执行 `mcp__memory__mem_search({ query: "验证用" })`。
**能搜到 = 读写共用同一个库。**

### 3. 写入（跨进程）

让 agent 调用 `mcp__memory__mem_write` 写一条，再用 CLI 查：

```bash
memhub search "agent" --limit 3
```

## 失败排查

| 现象 | 原因 | 处理 |
|---|---|---|
| 重启后没有 `mcp__memory__*` | 插件行未加载 | 检查 `cordis.patch.yml` YAML；看进程是否真的重启；恢复 `.bak-*` |
| 工具在但调用报错 | mcp server 启动失败 | 手动跑 `node src/mcp.mjs` 看 stderr |
| 搜不到 CLI 写的 | 两边 `MEMORY_HOME` 不同 | 确认 config 里 `MEMORY_HOME: /Users/<you>/Memory` |
| 应用起不来 | patch 写坏 | `cp cordis.patch.yml.bak-20261123-055743 cordis.patch.yml` |

## 回滚

```bash
cp ~/.dsh/profiles/desktop/cordis.patch.yml.bak-20261123-055743 \
   ~/.dsh/profiles/desktop/cordis.patch.yml
```
