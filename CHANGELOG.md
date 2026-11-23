# Changelog

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
