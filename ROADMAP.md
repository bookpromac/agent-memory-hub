# ROADMAP

## 已完成 v0.1（P0 + P1）

- [x] 目录与 frontmatter 规范（五类记忆、强制出处）
- [x] Markdown 事实源 + SQLite FTS5 trigram 索引（可重建）
- [x] 写入去重（内容哈希）、密钥拦截、墓碑、修订留存
- [x] CLI：init / write / search / get / recent / revise / forget / rebuild / stats
- [x] 零依赖 MCP stdio server（6 工具 + 2 resources）
- [x] 12 项冒烟测试

## v0.2 — 接入与可用性（P2）

- [x] `memhub doctor`：frontmatter 校验、孤儿链接、索引漂移检测
- [x] `memhub gc`：清理墓碑与过期 revisions（默认 dry-run）
- [ ] DSH 配置式 bundle 落地并验证 `mem_search` 可用
- [x] Claude Code / Codex 接入样例（`examples/`）
- [x] 适配文件模板：AGENTS.md / .cursor/rules
- [ ] 会话开场自动注入最近 5 条（DSH prompt context 插件）

## v0.3 — 审计与 Schema v2（已完成）

- [x] Schema v2：`valid_from` / `valid_to` / `anchors` / `prev_hash` / `hash`
- [x] 哈希审计链 + `memhub verify`
- [x] 观察级检索（`## 观察` 每条独立索引）
- [x] 修订改为「旧条目 superseded + 新条目追加」
- [x] `memhub migrate`（v1 → v2，自动备份）
- [x] 旧 SQLite 库版本升级路径

## v0.4 — 多接口框架（已完成）

- [x] 分层：store / tools / mcp / http / cli / adapters
- [x] HTTP 守护进程 + Bearer token
- [x] 适配器注册表（7 个）+ 本机检测 + 配置片段
- [x] `memhub import` 粗导入
- [x] HTTP 接口测试

## v0.5 — 读取路径（已完成）

- [x] `memhub digest`：常驻读取摘要（≤4KB，按优先级截断）
- [x] 摘要写进 AGENTS.md / CLAUDE.md 的约定模板
- [ ] 会话启动自动注入（依赖宿主插件）

## v0.6 — 逐个接通（进行中）

- [x] 接通 DSH（MCP bundle）—— 2026-11-23 验证通过
- [~] 接通 Claude Code —— MCP 已注册并 Connected，端到端待鉴权
- [ ] 接通 Codex
- [ ] 导入 OpenClaw/Hermes 历史并蒸馏

## v0.7 — 历史迁移（P3）

- [ ] `memhub import`：从 JSONL 会话抽取候选记忆（含 anchors/valid_from 推断）
- [ ] 子代理批量蒸馏 imported-agents（48,725 条 → 目标 100–300 条）
- [ ] 人工审核工作流（staging → accept/reject）

## v0.7 — 多仓库架构（已上线）

- [x] 每个 agent 独立仓库（git）
- [x] hub 聚合索引（owner/repo/content_hash）
- [x] 写隔离与身份校验
- [x] shared 只读投影 + manifest
- [x] 迁移现有 11 条

## v0.8 — 运维（P4）

- [ ] launchd 每日 `git commit`
- [ ] `memhub stats --agent` 写入分布
- [x] 备份/恢复文档（见 README「运维」待补）
- [ ] 索引重建性能基准
- [ ] 索引重建性能基准（10k 条 < 2s）

## v1.0 — 可发布

- [x] 包名（`memory-hub-mcp`）、License（MIT）
- [ ] 发布到 npm / GitHub
- [ ] 多语言支持（英文文案）
- [ ] 向量检索作为可选后端（不替代 FTS）
- [ ] 并发写压力测试（两个 agent 同时写 100 条）

## 明确不做

- 不做自动记忆提取（写入由 agent 显式决定）
- 不做云端托管 / 多租户（如要做，另立项目）
- 不接管不开放 MCP 的厂商（豆包、阶跃、扣子）
- 不做应用层加密（会破坏 grep 与 git diff）

## 待决问题

1. **产品定位**：个人工具 / 开源项目 / SaaS？当前按「开源本地工具」设计。
2. **FTS5 trigram 的体积代价**：索引约为原文 1.5–2 倍，超过 10 万条需评估。
3. **修订存储**：`revisions/` 会随修改累积，是否改为 git 管理而非文件副本？
