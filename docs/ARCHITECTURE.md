# 架构说明

完整设计见 `../../记忆中枢设计方案-2026-11-23.md`；本文只记录**实现层面**的决策与不变量。

## 分层

```
src/store.mjs   ← 唯一事实源操作：frontmatter 编解码、原子写、索引、检索
src/cli.mjs     ← 人机接口
src/mcp.mjs     ← agent 接口（JSON-RPC over stdio）
```

`store.mjs` 不依赖 CLI 或 MCP，任何前端都可以复用。

## 不变量（Invariants）

1. **Markdown 是唯一事实源**：删除 `index.sqlite` 后 `rebuild()` 必须能恢复全部可检索内容。
2. **写入必须带出处**：`source.agent` 缺失即抛错。
3. **删除不物理化**：`forget` 只写 `status: tombstoned` 并移出索引。
4. **修订不覆盖历史**：`revise` 先复制旧文件到 `revisions/<id>/<timestamp>.md`。
5. **内容去重**：空白归一化后的 SHA-256 相等即视为同一条。
6. **密钥不入库**：5 类正则（sk-/ghp_/AKIA/PRIVATE KEY/Bearer）命中即拒绝。
7. **审计链只追加**：`hash = sha256(prev_hash‖id‖created‖agent‖body)`；每条笔记的 `prev_hash` 必须指向已存在的笔记。
8. **修订不覆写**：`revise` 把旧条目标记 `superseded` 并写 `valid_to`，然后**新增**一条 `supersedes` 新条目。

测试 `test/smoke.mjs` 对这 6 条逐条断言。

## 索引

```sql
notes(id, path, kind, title, created, updated, confidence,
      review_at, source_agent, source_session, content_hash, tombstoned)
notes_fts(id UNINDEXED, title, body, tags, tokenize='trigram')
links(from_id, rel, to_id)
```

- `trigram` 是中文检索的前提：`unicode61` 对中文等同不分词。
- **观察级索引**：正文 `## 观察` 的每条 bullet 单独入 `obs_fts`，检索命中具体观察而非整篇。
- 2 字中文词（回滚/部署）低于 trigram 最小长度，自动回退到 `observations LIKE`。
- `bm25()` 越低越相关，排序取升序。
- 查询 <3 字时 trigram 无法匹配，自动回退 `LIKE`（标题/路径）。

## 失败模式

| 情况 | 行为 |
|---|---|
| 索引损坏 | `rebuild()` 全量重建，Markdown 不受影响 |
| 进程崩溃于写入中途 | 临时文件 + `rename` 原子替换，不会留下半截文件 |
| 两进程并发写 | SQLite WAL + `BEGIN IMMEDIATE`；文件名含 ULID 后缀避免碰撞 |
| MCP 客户端断开 | server 退出，无状态残留 |

## 已知限制

- 无向量检索（v1 有意为之：可解释优先）。
- `revise` 每次留存一份副本，长期需要 `gc`（v0.2）。
- 不支持跨设备同步（靠 git 手动）。
- 单机单用户；无鉴权（stdio 只对本地进程开放）。
