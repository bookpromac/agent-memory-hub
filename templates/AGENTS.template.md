# 工作区约定

## 长期记忆（Agent Memory Hub）

本机有跨智能体记忆库：`~/Memory`（Markdown 事实源）。下文「记忆摘要」由 `memhub dsh sync` 自动刷新，**每个会话自动注入**，不需要手动读。

### 读

- 摘要已在本文件中，直接使用。
- 需要细节：`mcp__memory__mem_search` / `mem_get` / `mem_recent`，或 `memhub search "关键词"`。

### 写

产生**以后还会用到**的结论时，用 `mcp__memory__mem_write`：

- 决策 → `decisions`（结论 / 理由 / 备选 / 影响）
- 稳定事实 → `facts`；偏好 → `preferences`；踩坑 → `episodes`
- `source_agent` 必填 `deepseek-harness`；一次任务最多 3 条；不写密钥

### 改与弃

过时用 `mem_revise`（旧版留痕），证伪用 `mem_forget`（墓碑）。

## 项目管理（agent-memory-hub）

开工前先看任务板：

```bash
cd agent-memory-hub
node scripts/pm.mjs list --status todo
node scripts/pm.mjs check
```

规则：任务状态同步到 `planning/tasks.json`；每轮结束 `pm report`。详见 `docs/PROJECT-MANAGEMENT.md`。

## 项目

代码在 `agent-memory-hub/`（零依赖，`node test/*.mjs` 跑测试）。
