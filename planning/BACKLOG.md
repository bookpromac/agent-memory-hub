# 任务清单（由 planning/tasks.json 生成，勿手改）

## E1 核心存储 — Markdown 事实源、索引可重建、审计链完整

| ID | 任务 | 状态 | 优先级 | 估时 | 验收 |
|---|---|---|---|---|---|
| T-012 | OpenClaw 历史导入（25 agent / 4,490 条） | done | P3 | 2h | 导入 20–40 条，与 Hermes 条目不重复 |

## E2 接口层 — MCP / HTTP / CLI / 文件导入四条通道稳定

| ID | 任务 | 状态 | 优先级 | 估时 | 验收 |
|---|---|---|---|---|---|
| T-003 | 会话启动自动注入最近记忆 | done | P2 | 3h | 新会话上下文自动含 DIGEST 摘要，无需手动读 |

## E3 智能体接入 — 每个智能体一个仓库，端到端可读可写

| ID | 任务 | 状态 | 优先级 | 估时 | 验收 |
|---|---|---|---|---|---|
| T-001 | Codex 接入记忆服务 ⛔Codex CLI 未安装（codex 命令不存在，app 已删除） | blocked | P1 | 1h | codex mcp list 显示 Connected；agent 能调用 mem_search |
| T-002 | Claude Code 端到端验证 ⛔Claude Code 未登录（401） | blocked | P1 | 0.5h | claude -p 查询能返回 DSH 写入的记忆 |

## E4 记忆治理 — 长期使用后检索仍准、摘要仍有用

| ID | 任务 | 状态 | 优先级 | 估时 | 验收 |
|---|---|---|---|---|---|
| T-004 | 治理命令：review / archive / health | done | P1 | 4h | 能列出重复/过期/冲突；archive 可回滚；health 输出指标 |
| T-005 | 访问计数与衰减评分 | done | P1 | 2h | mem_get/mem_search 更新 uses；score 可计算并用于排序 |
| T-006 | 86 条导入记忆抽查（≥20 条） | done | P1 | 1h | 抽查准确率 ≥90%，错误条目修订或 forget |
| T-007 | 手机号等敏感信息脱敏 | dropped | P2 | 0.5h | 记忆库中无完整手机号；提供脱敏命令 |

## E5 运维 — 定时任务、备份、可观测、可回滚

| ID | 任务 | 状态 | 优先级 | 估时 | 验收 |
|---|---|---|---|---|---|
| T-008 | 每日 git 提交与备份 | done | P2 | 1h | launchd 每日提交各 agent 仓库；备份可通过脚本恢复 |
| T-009 | 并发写与 10k 条性能基准 | done | P3 | 2h | 两 agent 并发写 100 条不丢；10k 条检索 <500ms |

## E6 发布 — 文档、License、CI、npm/GitHub 可发布

| ID | 任务 | 状态 | 优先级 | 估时 | 验收 |
|---|---|---|---|---|---|
| T-010 | 发布到 GitHub 并打 tag | done | P2 | 2h | 仓库公开、README 完整、有 v1.0.0 tag |
| T-011 | 英文 README 与安装说明 | done | P3 | 2h | 英文 README 覆盖安装/接入/工具说明 |
