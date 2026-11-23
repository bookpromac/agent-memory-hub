# Changelog

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
