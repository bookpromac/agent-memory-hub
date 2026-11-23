# Changelog

## v0.7.0 — 2026-11-23

### 架构变更（破坏性）
- **每个智能体一个独立 git 仓库**：`~/Memory/agents/<id>/memories`，各自有链、各自可备份
- **hub 目录**：聚合索引移到 `hub/index.sqlite`，新增 `owner / repo_path / content_hash / duplicate_of`
- **shared 投影**：`shared/` 由 hub 生成，其他 agent 只读它，读不到别人的仓库
- **写隔离**：`MEMORY_AGENT` 决定身份，越权写被拒（MCP 实测）
- **注册表**：`hub/registry.json` 记录每个 agent 的可见性与读范围

### 新增命令
- `memhub agents [list|register <id>]`
- `memhub migrate-multi [--yes]`
- `memhub project`

### 修复
- 迁移后链头丢失 → 写入回退 + 重建收敛 + `verify` 增加 `multiple-roots` 检测
- `digest` 支持按 owner 范围与 bare 模式（供 shared 摘要复用）

## v0.6.1 — 2026-11-23

### 接入
- Claude Code 注册同一 MCP 服务（user scope），`claude mcp list` → ✔ Connected
- 工作区新增 `CLAUDE.md` 记忆约定
- 说明：agent 级调用待 Claude Code 鉴权（401），MCP 层已验证

## v0.6.0 — 2026-11-23

### 里程碑
- **DeepSeek Harness 接通**：`mcp__memory__*` 6 个工具 + 3 个 resources 注册成功
- 跨接口验证：CLI 写 → MCP 读、MCP 写 → CLI 读，同一份库
- 本地会话的读取路径落地：工作区 `AGENTS.md` + `~/Memory/DIGEST.md`

### 修复
- DSH 适配器片段改为 `- insert:` 包裹（顶层行会被 Loader 静默忽略）
- 文档记录两个坑：insert 包裹、新增行需重启

## v0.5.0 — 2026-11-23

### 新增
- **`memhub digest`**：生成 `~/Memory/DIGEST.md`（默认 ≤4 KB），把记忆压成智能体每轮必读的摘要
- 摘要排序：生效事实 → 偏好 → 关键实体 → 最近决策 → 待复核（超预算按优先级截断）
- `summaryOf()`：从正文「## 结论」提取一句话摘要
- 示例 `AGENTS.md.example` 增加「先读 DIGEST.md」约定

### 说明
这是补齐**读取路径**：此前只有 `mem_search`（能力），没有"被读取"的保证（行为）。

## v0.4.0 — 2026-11-23

### 新增
- **框架分层**：`store`（核心）/ `tools`（契约）/ `mcp` · `http` · `cli`（接口）/ `adapters`（智能体接入）
- **HTTP 守护进程**：`memhub serve`，仅监听 127.0.0.1，Bearer token 鉴权
- **适配器注册表**：dsh / claude-code / codex / cursor / http / cli / import，含本机检测与配置片段生成
- **`memhub adapters [list|detect|show <id>]`**
- **`memhub import <jsonl>`**：把只能导出的智能体历史粗导入为记忆
- 接口测试 9 项（鉴权、检索、写入、审计、错误码）

### 变更
- MCP 与 HTTP 共用 `src/tools.mjs` 契约，避免两套实现漂移

## v0.3.0 — 2026-11-23

### 新增
- **Schema v2**：`valid_from` / `valid_to`（双时态语义）、`anchors`（检索锚词）、`prev_hash` / `hash`
- **哈希审计链**：每次写入链接上一条；`memhub verify` 可检出任何历史篡改
- **观察级检索**：`## 观察` 下的每条 bullet 独立建索引，返回命中的具体观察
- **修订语义改为追加**：旧条目标记 `superseded` + `valid_to`，新条目写入链尾（不再原地覆盖）
- `memhub migrate`：v1 → v2 升级，自动备份到 `backups/pre-v2-*`
- MCP 新 resource `memory://audit`
- 标题行（`ord = -1`）进入索引，只出现在标题里的词也能被全文检索命中
- 旧 SQLite 库用 `schema_version` 标记检测并重建索引

### 变更
- 2 字中文查询回退到观察表 LIKE（trigram 最少 3 字）
- 搜索默认排除 `superseded` 与墓碑
- 测试从 15 项增至 18 项

## v0.2.0 — 2026-11-23

### 新增
- `memhub doctor`：体检 frontmatter 合法性、重复内容、断链、索引漂移；有 error 时退出码 1
- `memhub gc`：清理墓碑与过期修订，**默认 dry-run**，需 `--yes` 才真正删除
- `examples/`：Claude Code MCP 配置、DSH 配置式 bundle、AGENTS.md 与 Cursor 规则模板
- CI：Node 22/24/26 矩阵跑冒烟测试与 doctor
- `LICENSE`（MIT）、`CONTRIBUTING.md`

### 变更
- 包名定为 `memory-hub-mcp`（npm 上 `agent-memory-hub`、`memhub` 已被占用）
- 示例指令文件改名为 `AGENTS.md.example`，避免被 agent 当作生效指令加载

## v0.1.0 — 2026-11-23

### 首个可用版本
- Markdown 事实源 + SQLite FTS5（trigram）可重建索引
- 五类记忆模型，强制 `source.agent` 与 `confidence`
- 写入去重、密钥拦截、墓碑、修订留存
- CLI：init / write / search / get / recent / revise / forget / rebuild / stats
- 零依赖 MCP stdio server：6 工具 + 2 resources
- 12 项冒烟测试
