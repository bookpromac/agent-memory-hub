# 多仓库记忆存储架构（v0.7 设计稿）

- 目标：**每个智能体一个独立仓库**，托管工具聚合读取，其他智能体只读投影
- 前提：保留现有审计链与 Markdown 事实源
- 状态：设计稿，未实现

---

## 一、总体结构

```
~/Memory/
├── agents/                          ← 每个智能体一个独立 git 仓库
│   ├── deepseek-harness/
│   │   ├── .git/
│   │   ├── agent.json               { id, displayName, visibility, createdAt }
│   │   ├── DIGEST.md                该 agent 视角的摘要
│   │   └── memories/{facts,preferences,entities,decisions,episodes}/
│   ├── claude-code/
│   └── codex/
│
├── hub/                             ← 托管工具私有，不属于任何 agent
│   ├── index.sqlite                 聚合索引（notes 增加 owner / repo 列）
│   ├── registry.json                已登记 agent 与权限
│   └── audit/events.jsonl           跨仓库写入事件（追加）
│
├── shared/                          ← 只读投影：其他智能体只能读这里
│   ├── DIGEST.md                    跨 agent 摘要
│   ├── memories/                    可见记忆的 Markdown 副本（单向生成）
│   └── manifest.json                投影元数据（来源、生成时间、条数）
│
└── archive/                         ← 冷存储，按 agent 分目录
```

**三条硬边界**：

1. 智能体只能写自己仓库（`agents/<own>/`），跨仓库写被拒绝
2. 智能体只能读 `shared/`（或自己仓库），读不到别人的仓库
3. `hub/` 只由托管工具读写，任何智能体都不直接改

---

## 二、身份与权限

`hub/registry.json`：

```json
{
  "agents": {
    "deepseek-harness": {
      "displayName": "DeepSeek Harness",
      "repo": "agents/deepseek-harness",
      "visibility": "shared",      // private | shared
      "readScope": "own+shared"    // own | own+shared | all
    },
    "claude-code": { "visibility": "shared", "readScope": "own+shared" }
  }
}
```

- **写身份**：MCP server 启动时读 `MEMORY_AGENT` 环境变量（或 CLI `--agent`）
- **写校验**：目标路径必须是 `agents/<自己>/`，否则拒绝
- **读范围**：默认 `own+shared`；`memhub` 管理命令可 `--all`
- **可见性**：`private` 记忆不进入 shared 投影，只有本人和 hub 能看

> 诚实说明：这是**本地防误操作**，不是安全边界。同一用户下任何进程都能改环境变量伪装身份。真正的隔离需要独立 OS 用户或签名，不在 v1 范围。

---

## 三、索引模型

```sql
notes(
  id, owner, repo_path, path, kind, title, created, updated,
  valid_from, valid_to, confidence, review_at,
  source_agent, source_session, anchors,
  prev_hash, hash, status, tombstoned,
  content_hash, duplicate_of      -- 新增：跨仓库重复聚簇
)
```

- `owner`：记忆归属，等于 agent id
- `repo_path`：相对 `~/Memory` 的仓库路径
- `content_hash`：正文归一化哈希（跨仓库可比）
- 同一内容被两个 agent 各写一遍 → **不合并**，后写者记 `duplicate_of`，检索时聚成一组显示

为什么不在写入时合并：两个 agent 各自写下的同一结论，本身就是"独立印证"，合并会丢掉这个信号。

---

## 四、写入路径

```
agent 调用 mem_write
   │
   ├─ 1. 解析身份（MEMORY_AGENT / --agent）
   ├─ 2. 校验 registry + 目标仓库归属
   ├─ 3. 六道关（类型/出处/密钥/去重/哈希链/原子写）—— 同现有
   ├─ 4. 写入 agents/<own>/memories/...
   ├─ 5. 更新 hub 索引（带 owner / repo）
   ├─ 6. 追加 hub 审计事件 {ts, agent, op, id, hash, repo}
   └─ 7. 若 visibility=shared → 标记待投影（增量）
```

---

## 五、读取路径

| 读取方式 | 数据源 | 看到什么 |
|---|---|---|
| MCP `mem_search` | hub 索引 | 自己 + shared 投影的条目 |
| MCP `mem_get` | 自己仓库 / shared 副本 | 全文 |
| `shared/DIGEST.md` | 投影 | 跨 agent 的 4KB 摘要 |
| `agents/<own>/DIGEST.md` | 自己仓库 | 本 agent 视角摘要 |
| 直接读文件 | 只有自己能读自己仓库 | — |

**其他智能体读不到 `agents/<别人>/`**——这是本方案的核心约束。

---

## 六、投影（shared/）机制

- `shared/` 是**生成物**，不是真相源；可随时删除重建
- 生成时机：每次 shared 写入后增量更新 + 每日全量重建
- 每个副本文件头写入来源：

```markdown
<!-- source: agents/deepseek-harness/memories/decisions/2026-11/xxx.md -->
<!-- owner: deepseek-harness · projected: 2026-11-23T12:40Z -->
```

- `manifest.json` 记录：生成时间、条目数、各 agent 贡献数、被排除的 private 条数

---

## 七、审计：两层

| 层 | 位置 | 作用 |
|---|---|---|
| 仓库内链 | `agents/<id>/.git` + `prev_hash/hash` | 每个 agent 自己的记忆不可篡改 |
| 跨仓库事件 | `hub/audit/events.jsonl` | 谁在什么时候写了什么（顺序、来源） |
| 每日锚定 | `hub/audit/anchors/<date>.json` | 当天事件哈希根，防批量篡改 |

`verify` 顺序：先校验各仓库内链，再校验 hub 事件与锚定。

---

## 八、版本化

- 每个仓库独立 `git init`，托管工具每日自动提交（`memory: 2026-11-23 自动提交`）
- 好处：单个 agent 的仓库可以单独导出/迁移/分享，不影响别人
- 代价：提交噪音；用 `.gitignore` 排除索引与临时文件

---

## 九、接口变化

| 接口 | 变化 |
|---|---|
| CLI | `--agent` 或 `MEMORY_AGENT`；新增 `agents list/register`、`project`（重建 shared） |
| MCP | server 启动读 `MEMORY_AGENT`；写越界返回明确错误 |
| HTTP | `X-Agent` 头或 token 绑定 agent；缺省拒绝写 |
| 摘要 | 每 agent 一份 + `shared/DIGEST.md` 一份 |

---

## 十、迁移步骤

1. 备份 `~/Memory`（已完成过多次，做一次全量）
2. `agents/deepseek-harness/memories` ← 现有 `memories/`（10 条）
3. `agents/cli-test/memories` ← `cli-test` 的 1 条
4. 每个仓库 `git init` + 首次提交
5. `index.sqlite` 加 `owner/repo_path/content_hash/duplicate_of`，全量 rebuild
6. 首次生成 `shared/` 投影与两份 DIGEST
7. DSH 的 MCP 配置加 `MEMORY_AGENT=deepseek-harness`；Claude Code 加 `claude-code`
8. 旧 `memories/` 保留只读 7 天后再删

---

## 十一、风险与取舍

| 风险 | 影响 | 缓解 |
|---|---|---|
| 复杂度翻倍 | 两套链、投影、身份 | 先做 P0/P1，投影放最后 |
| 投影延迟 | 其他 agent 读到旧数据 | 写入后同步刷新，最坏延迟一次写入 |
| 身份可伪造 | 本地隔离失效 | 明确定位为"防误操作"，不宣称安全 |
| 重复条目变多 | 检索噪音 | `duplicate_of` 聚簇 + 检索折叠 |
| git 提交噪音 | 仓库膨胀 | 每日一次 + 压缩旧提交（暂不做） |

---

## 十二、与备选方案对比

| 方案 | 隔离 | 复杂度 | 适用 |
|---|---|---|---|
| A. 单库 + owner 字段 | 逻辑隔离 | 低 | 只求标注归属 |
| B. 每 agent 目录（无 git） | 路径隔离 | 中 | 求隔离但不要版本化 |
| **C. 每 agent git 仓库（本方案）** | 路径 + 版本隔离 | 高 | 要独立备份/迁移/分享 |
| D. 每 agent 独立服务 | 进程隔离 | 很高 | 多用户/多机 |

**建议**：先按 C 做，但把 git 提交做成可选（`autoCommit: false` 也能用）。如果两周后发现隔离没带来实际价值，退回 B 只需移一次目录。

---

## 十三、分期实施

| 阶段 | 内容 | 工时 | 验收 |
|---|---|---|---|
| P0 | 目录脚手架 + 迁移现有 11 条 + 备份 | 1 h | `agents/*/memories` 就位，旧路径可回滚 |
| P1 | 索引加 owner/repo + 身份校验 + 写隔离 | 2 h | 跨仓库写被拒，`mem_search` 带 owner |
| P2 | shared 投影 + 每 agent DIGEST | 2 h | 另一个 agent 只读 `shared/` 能拿到内容 |
| P3 | hub 审计事件 + verify 扩展 | 2 h | 篡改仓库文件能被发现 |
| P4 | 自动 git 提交 + 重建脚本 | 1 h | 每日一次提交，可单独 checkout |

总计约 **8 小时**，可分两天。

---

## 十四、实施结果（2026-11-23 已上线）

### 实际结构

```
~/Memory/
├── agents/
│   ├── deepseek-harness/   （10 条 → 迁移后 11 条，独立 git）
│   └── cli-test/           （1 条，独立 git）
├── hub/
│   ├── index.sqlite         owner/repo_path/content_hash/duplicate_of 已加
│   └── registry.json        两个 agent 均 visibility=shared
├── shared/
│   ├── DIGEST.md            12 条聚合摘要
│   ├── memories/            按 agent 分目录的只读副本
│   └── manifest.json        counts / copied / excludedPrivate
└── backups/pre-multiagent-20261123-073545.tar.gz
```

### 验证结果

| 检查 | 结果 |
|---|---|
| 写自己仓库 | ✅ 路径 `agents/deepseek-harness/memories/...` |
| 越权写被拒 | ✅ MCP 返回「身份不匹配：当前 agent=deepseek-harness，不能写入 claude-code 的仓库」 |
| private 不可见 | ✅ 测试覆盖（beta 设 private 后 alpha 搜不到） |
| shared 投影 | ✅ 12 条，manifest 记录来源与排除数 |
| 迁移幂等 | ✅ dry-run 报告 11 条，`--yes` 执行后旧目录清空 |
| 各仓库 git | ✅ 每个独立提交，互不影响 |

### 踩到的坑

1. **迁移后链头丢失**
   旧数据没有 `owner` 字段，重建时按 `source.agent` 回填；但链头恢复逻辑只在"恰好一个根"时写入，导致多条根时新写入变成第二条链的起点。
   修复：`writeNote` 在链头缺失时回退到该 owner 最新一条的 hash；`rebuild` 改为取最新记忆作为链头；`verify` 新增 `multiple-roots` 检测。

2. **launchd 的 TCC 限制仍在**
   定时任务只跑 `dsh sync --no-embed`（不触碰 `~/Documents`），才不会被挂起。

### 命令

```bash
memhub agents list                      # 各仓库条数与注册状态
memhub agents register <id>             # 登记新 agent
memhub migrate-multi [--yes]            # 旧布局迁移
memhub project                          # 重建 shared/ 投影
MEMORY_AGENT=<id> memhub ...            # 指定身份
```
