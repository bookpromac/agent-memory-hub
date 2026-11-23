# 竞品调研与重构方案

- 日期：2026-11-23
- 目的：摸清市面同类项目的设计取舍，判断哪些该借鉴、哪些该绕开，并据此重设计 v0.3
- 结论先行：**架构不用推翻，但"可审计"这个差异化必须做实**，否则只是个更小的 Basic Memory

---

## 一、市场全景（2026-11）

| 项目 | Star | 形态 | 核心设计 |
|---|---:|---|---|
| [mem0](https://github.com/mem0ai/mem0) | 69.4k | 库/服务 | 自动抽取记忆，2025 起从 ADD/UPDATE/DELETE 改为**单遍 ADD-only**，检索用多信号混合 |
| [claude-mem](https://github.com/thedotmack/claude-mem) | 77.2k | Claude Code 插件 | 6 个 hook 自动捕获，SQLite + Chroma 存储 |
| [MCP 官方 servers](https://github.com/modelcontextprotocol/servers) | 92.2k | 参考实现 | 知识图谱存单个 JSON，工具 9 个 |
| [Graphiti](https://github.com/getzep/graphiti) | 33.0k | 图引擎 | **双时态**（valid time + ingestion time）知识图谱 |
| [Letta](https://github.com/letta-ai/letta) | 25.5k | Agent 运行时 | Core Memory Blocks：常驻上下文的可编辑块，2–5k 字符/块，5–15 块 |
| [Supermemory](https://github.com/supermemoryai/supermemory) | 22.7k | 跨 LLM 记忆 | MIT，主打"跨模型可携带" |
| [Basic Memory](https://github.com/basicmachines-co/basic-memory) | 4.7k | 本地 MCP | Markdown + 观察/关系 + schema，要求每笔记 3–5 观察、2–3 关系 |
| [Zep](https://github.com/getzep/zep) | 5.0k | 时序记忆 | 社区版已停维护 |
| [Memobase](https://github.com/memodb-io/memobase) | 3.0k | 用户画像记忆 | 面向聊天产品的长期画像 |

另有几个信号值得单独拎出来：

- **Anthropic 官方 Memory Tool**（`memory_20250818`）：客户端侧 `/memories/*.md` 文件。**官方亲自验证了"Markdown 当记忆"这条路**，只是没做跨 agent 共享。
- **Microsoft Memora**（ICML 2026）：写入时做合并（相似度 ≥0.80 触发 LLM 判定），加"cue anchors"（1–3 个锚词）。LoCoMo 0.863 / LongMemEval 87.4%，**比全上下文推理省约 98% token**。
- **nautilus-compass**：用 Merkle 链做**防篡改审计日志**——和我们要做的"可审计"直接相关。
- **mimir**：单 SQLite 文件 + BM25 + 本地 ONNX 向量，用 RRF 融合。证明"零外部服务也能混合检索"。

---

## 二、最值得抄的五个设计

### 1. ADD-only 是经过验证的简化（mem0 v3）

mem0 把 ADD/UPDATE/DELETE 三段式（两次 LLM 调用）**退回到单遍 ADD-only**，理由是：更新冲突判定不可靠，成本高，检索层能吸收冗余。

> "With ADD-only extraction, memory counts will grow over time rather than being consolidated. This is by design: retrieval handles relevance ranking." —— [mem0 迁移文档](https://docs.mem0.ai/migration/oss-v2-to-v3)

**对我们的意义**：我们已经是"追加 + 显式修订"，方向正确，不必引入自动合并。但要承认代价：**记忆会膨胀**，所以必须有 `gc` 与 `review_at`（我们已有）。

### 2. 双时态是"可审计"的技术底座（Graphiti）

Graphiti 区分 **valid time**（事实何时为真）和 **ingestion time**（何时被记录）。两者缝在一起才能回答："当时为什么这么决定"。

**对我们的意义**：现在只有 `created/updated`，无法表达"这条记忆在 2026-08 之前是对的"。**必须加 `valid_from` / `valid_to`**，否则"可审计"只是一句口号。

### 3. 观察 + 关系的最小结构（Basic Memory）

Basic Memory 的笔记不是自由文本，而是**观察（observations）+ 关系（relations）+ 可选 schema**，并强制"3–5 条观察、2–3 条关系"。

**对我们的意义**：自由文本难以去重、难以片段级检索。给 memory 加结构化观察后，`mem_search` 能返回命中**具体哪条观察**，而不只是整篇摘要。

### 4. 短锚词提升召回（Memora）

Memora 给每条记忆挂 1–3 个"cue anchor"短语，用于检索时的线索匹配。成本极低，收益在论文里已验证。

**对我们的意义**：中文 trigram 检索对同义改写不敏感（"智能体"vs"agent"），锚词能补上一层不依赖向量的桥。

### 5. 防篡改审计链（nautilus-compass）

每条写入带 `prev_hash`，形成 Merkle 链。任何历史改写都会被发现。

**对我们的意义**：这是我们唯一能区别于 mem0 / Basic Memory 的**结构性能力**。没有它，"可审计"只是加了几个字段。

---

## 三、明确不抄的部分

| 设计 | 为什么不做 |
|---|---|
| 自动抽取（mem0、claude-mem 的 hook） | 与"写作由 agent 显式决定"冲突；脏记忆的代价高于漏记 |
| 向量检索作为默认 | 需要模型/服务，破坏零依赖；留作 v1 可选后端（RRF 融合，参考 mimir） |
| 常驻上下文块（Letta core memory） | 那是 agent 运行时的职责，不是记忆层的；我们只做注入接口 |
| 图数据库（Graphiti/Neo4j） | 文件内 `links` 已够表达；引入 Neo4j 直接毁掉"可拷贝、可 git"的优势 |
| 多租户/云端（Supermemory 的商业面） | 与本地优先定位冲突，另立项目 |

---

## 四、重构结论：v0.3 的五处改动

架构三层（存储/协议/适配）不变，改动集中在**数据模型**与**审计**。

### 4.1 Schema v2

```yaml
---
id: 01J...
kind: decisions
title: 只保留一个智能体
created: 2026-11-23T10:31:34Z
updated: 2026-11-23T10:31:34Z
valid_from: 2026-11-23          # 新增：事实开始为真的时间
valid_to:                       # 新增：失效时间（空=仍然有效）
anchors: [智能体, agent, 收敛]   # 新增：1–3 个检索锚词
source:
  agent: deepseek-harness
  session: 440a6d9b
confidence: high
prev_hash: 9f2c...              # 新增：上一条记忆的链哈希
hash: 4a71...                   # 新增：本条内容哈希（含 prev_hash）
links:
  - rel: supersedes
    target: 01H...
schema: 2
---
## 结论
...

## 观察
- [scope=本机] 只保留 DSH 一个 agent 框架
- [scope=回滚] 原始 SQLite 已删，仅存导出副本
```

**兼容策略**：`schema: 1` 的旧文件照常可读；写入时自动升级。

### 4.2 工具面微调（仍保持 6 个）

| 工具 | 变化 |
|---|---|
| `mem_search` | 返回 `observations` 命中项 + `anchors` |
| `mem_write` | 新增 `anchors`、`valid_from`；服务端计算 `hash`/`prev_hash` |
| `mem_get` | 返回审计链位置（第 N 条、前后哈希） |
| `mem_revise` | 保留旧版 + 记录 `valid_to` |
| 新 resource `memory://audit` | 链式审计视图（只读） |

不新增工具，避免上下文成本。

### 4.3 审计链

```
hash_n = sha256(prev_hash + id + body_normalized + source.agent + recorded_at)
```

- 写入即链接，不可回溯修改
- `memhub verify` 校验全链完整性（新增 CLI 命令）
- 只做"防篡改检测"，不做签名（签名需要密钥管理，v1 再说）

### 4.4 会话开场注入

参考 claude-mem 与 Letta：提供一个 **DSH prompt context 插件**（后续可做成 MCP resource），在会话开始时注入：

```
最近决策 3 条 + 置顶偏好 2 条 + 与当前工作目录相关的记忆 2 条
```

这解决我们之前承认的最大弱点——"agent 不去读"。

### 4.5 观测级检索

`mem_search` 从"整篇文档 FTS"改为"观察级 FTS"：每条 observation 建索引行，返回时聚合到文档。代价是索引膨胀约 2–3 倍，收益是命中更准。

---

## 五、定位再确认

调研后我的判断更明确了：

| 项目 | 它解决什么 | 我们不做什么 |
|---|---|---|
| mem0 | 自动记住用户偏好（面向产品） | 不做自动抽取 |
| Letta | agent 运行时自带记忆 | 不做运行时 |
| Basic Memory | PKM 式知识库 | 不做笔记应用 |
| claude-mem | Claude Code 单客户端 | 不绑单一客户端 |
| **我们** | **跨 agent、可审计、文件可读** | |

**一句话定位**：
> 你的 agent 会换，但记忆的出处和证据链不该丢。

这个定位下，卖点排序应该是：**审计链 > 跨客户端 > 文件可读**。之前我们把"文件可读"放第一，是错的——那是 Basic Memory 已经做好的事。

---

## 六、风险与代价

1. **Schema v2 是破坏性变更**：需写迁移脚本，旧文件自动升级。
2. **审计链会让并发写变复杂**：需要全局写锁保证链连续，写入吞吐下降到单线程水平（可接受，写作频率低）。
3. **观察级索引体积翻倍**：10 万条时需要评估（预计 1–2 年后）。
4. **锚词需要模型或人工生成**：零依赖前提下，先用启发式（标题分词 + 标签），后续可选 LLM。

---

## 七、建议的下一步

1. 先做 **Schema v2 + 审计链**（v0.3，约 4–6 小时）——这是差异化的地基
2. 再做观察级检索（v0.3.1）
3. 会话开场注入放到 DSH 插件里（v0.4）
4. 全部做完再考虑发布——否则发出去只是个更小的 Basic Memory
