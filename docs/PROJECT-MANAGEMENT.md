# 精细化管理规则

> 适用于本项目（agent-memory-hub）。目标：任何时刻都能回答"现在到哪了、下一步做什么、谁在做、卡在哪"。

## 一、任务即数据

任务存在 `planning/tasks.json`，与代码同一个 git 仓库：

```json
{
  "id": "T-004",
  "epic": "E4",
  "title": "治理命令：review / archive / health",
  "status": "todo",
  "priority": "P1",
  "estimate": 4,
  "owner": "lead",
  "deps": ["T-005"],
  "accept": "能列出重复/过期/冲突；archive 可回滚；health 输出指标",
  "updated": "2026-11-23"
}
```

| 字段 | 规则 |
|---|---|
| `id` | `T-###`，自增，永不复用 |
| `epic` | 必须属于 six epics 之一（核心/接口/接入/治理/运维/发布） |
| `status` | `todo` → `doing` → `review` → `done`；异常态 `blocked` / `dropped` |
| `priority` | `P0` 阻断 / `P1` 本轮 / `P2` 下轮 / `P3` 有空 |
| `estimate` | 小时，≤4h；超过就拆分 |
| `owner` | `lead`（agent）或 `user`（需要人操作） |
| `deps` | 前置任务 id；未完成时不应开始 |
| `accept` | **必填**。没有验收标准的任务不允许进 backlog |
| `blockedBy` | 仅 `blocked` 状态需要，写清具体阻塞原因 |

## 二、状态机

```
todo ──开始──► doing ──自测通过──► review ──验收──► done
                 │                    │
                 └──卡住──► blocked ◄──┘
                              │
                         解除后回 todo
```

- 进入 `doing` 必须同时写下"正在做什么"（任务标题即说明）
- 进入 `review` 意味着代码/文档已就绪、测试已跑
- `done` 必须满足 DoD

## 三、完成定义（DoD）

一个任务算完成，必须四项都齐：

1. **代码**：实现完成，无临时开关
2. **测试**：新增或更新测试并通过（`node test/*.mjs`）
3. **文档**：README/ROADMAP/CHANGELOG 有对应更新
4. **记忆**：影响架构或偏好的决定写入记忆库（`mem_write`，source_agent=deepseek-harness）

缺任何一项都只能进 `review`，不能进 `done`。

## 四、节奏

| 时机 | 动作 | 命令 |
|---|---|---|
| 每轮开始 | 看可立即开始的任务 | `node scripts/pm.mjs list --status todo` |
| 开工 | 置 doing | `pm.mjs set T-004 --status doing` |
| 卡住 | 置 blocked + 原因 | `pm.mjs set T-004 --status blocked --blockedBy "..."` |
| 完成 | 置 done | `pm.mjs set T-004 --status done` |
| 每轮结束 | 重新生成看板 | `node scripts/pm.mjs report` |
| 每周 | 查停滞与依赖 | `node scripts/pm.mjs check` |

## 五、度量

`pm report` 输出：

| 指标 | 含义 | 健康 |
|---|---|---|
| open | 未完成任务数 | 10–25 |
| ready | 依赖已满足、可立即开始 | ≥3 |
| hours | 待办总估时 | < 40h |
| blocked | 阻塞数 | 0 最好，>2 要处理 |
| 停滞 | doing 超过 14 天 | 0 |

## 六、与 DSH 工具的分工

| 层级 | 工具 | 用途 |
|---|---|---|
| 轮内多步 | `todo_write` | 当前这一轮的执行步骤，做完即清 |
| 跨轮任务 | `pm` + `tasks.json` | 项目 backlog，跨会话保留 |
| 长期目标 | DSH `goal` | 跨多轮的大目标（如"发布 v1.0"） |
| 团队任务板 | `agent_team` | 多代理并行时的共享任务 |

`todo_write` 是战术，`pm` 是战役，`goal` 是战略——不要混用。

## 七、给 agent 的硬规则

1. 接手任务前先 `pm list`，不要凭记忆开工
2. 任务状态变更必须同步 `tasks.json`，不能只在对话里说
3. 新发现的问题 → `pm add`，不要口头记下
4. 每轮结束跑 `pm report`，保证看板不过期
5. `accept` 没想清楚的任务不许开始
