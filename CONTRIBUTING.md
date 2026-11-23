# 贡献指南

## 开发

```bash
git clone <repo> && cd agent-memory-hub
node test/smoke.mjs        # 无依赖，不需要 npm install
```

要求 Node ≥ 22.5（依赖内置 `node:sqlite`）。

## 设计约束（改动前必读）

这 6 条是不变量，任何 PR 都不得破坏，`test/smoke.mjs` 会逐条断言：

1. Markdown 是唯一事实源；删除 `index.sqlite` 后 `rebuild()` 必须能恢复
2. 写入必须带 `source.agent`
3. 删除不物理化（墓碑 + `gc` 才清理）
4. 修订不覆盖历史（旧版进 `revisions/`）
5. 内容去重基于空白归一化后的 SHA-256
6. 疑似密钥必须拒绝写入

## 提交

- 一个 PR 做一件事
- 新功能必须带测试
- 涉及协议（MCP 工具签名）的改动需同步 `README.md` 与 `docs/ARCHITECTURE.md`

## 不接受的改动

- 引入运行时 npm 依赖（保持零依赖是核心卖点，测试框架除外）
- 把记忆改成二进制或数据库存储
- 移除出处/置信度字段
- 加入云端同步或多租户（属于另一个项目）

## 报告问题

请附：Node 版本、`memhub doctor` 输出、最小复现步骤。
**不要**在 issue 里粘贴真实记忆内容，用占位文本代替。
