// 冒烟测试 v2：写入、中文检索、观察级索引、去重、修订、墓碑、审计链、迁移、doctor/gc、MCP
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { MemoryStore } from '../src/store.mjs';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'memhub-test-'));
process.env.MEMORY_HOME = tmp;
const store = new MemoryStore(tmp);

// 1. 写入：v2 字段齐全
const w = store.writeNote({
  kind: 'decisions',
  title: '只保留一个智能体框架',
  body: '## 结论\n本机只保留 DeepSeek Harness 一个智能体框架。\n\n## 观察\n- [scope=本机] 其余框架已删除\n- [scope=回滚] 原始 SQLite 已删，仅存导出副本\n- [scope=风险] 端口暴露已随服务停止而消失',
  tags: ['agent', 'cleanup'],
  confidence: 'high',
  source: { agent: 'dsh', session: 'test-1' },
});
assert.ok(w.id && w.hash && w.prev_hash === '', '首条应无前驱哈希');
assert.equal(w.duplicate, false);

// 2. 文件结构
const raw = fs.readFileSync(w.path, 'utf8');
assert.match(raw, /^---\n/);
assert.match(raw, /schema: 2/);
assert.match(raw, /valid_from: \d{4}-\d{2}-\d{2}/);
assert.match(raw, /anchors: \[/);
assert.match(raw, /hash: [0-9a-f]{64}/);

// 3. 观察级检索：命中具体某条观察
const r1 = store.search('回滚');
assert.equal(r1.length, 1);
assert.ok(r1[0].hits.some((h) => h.text.includes('回滚')), '应命中「回滚」那条观察');

// 4. 中文全文检索
const r2 = store.search('智能体框架');
assert.ok(r2.length >= 1 && r2[0].title.includes('智能体'));

// 5. 短词回退（<3 字）
assert.ok(store.search('框架').length >= 1, '短词应回退标题匹配');

// 6. 去重
const w2 = store.writeNote({
  kind: 'decisions', title: '重复内容',
  body: '## 结论\n本机只保留 DeepSeek Harness 一个智能体框架。\n\n## 观察\n- [scope=本机] 其余框架已删除\n- [scope=回滚] 原始 SQLite 已删，仅存导出副本\n- [scope=风险] 端口暴露已随服务停止而消失',
  confidence: 'high', source: { agent: 'dsh' },
});
assert.equal(w2.duplicate, true);
assert.equal(w2.id, w.id);

// 7. 校验
assert.throws(() => store.writeNote({ kind: 'facts', title: 'x', body: 'y', source: {} }), /source.agent/);
assert.throws(() => store.writeNote({ kind: 'nope', title: 'x', body: 'y', source: { agent: 'a' } }), /kind/);
assert.throws(() => store.writeNote({ kind: 'facts', title: '', body: 'y', source: { agent: 'a' } }), /title/);

// 8. 密钥拦截
assert.throws(
  () => store.writeNote({ kind: 'facts', title: 'k', body: 'key: sk-abcdefghijklmnopqrstuvwxyz', source: { agent: 'a' } }),
  /密钥/,
);

// 9. 审计链：第二条应接在第一条之后
const w3 = store.writeNote({
  kind: 'facts', title: '机器型号', body: '## 观察\n- 2023 款 MacBook Pro，arm64',
  source: { agent: 'dsh' }, confidence: 'high',
});
assert.equal(w3.prev_hash, w.hash, 'prev_hash 应指向写链头');
const v1 = store.verify();
assert.equal(v1.ok, true, `审计链应完整：${JSON.stringify(v1.problems)}`);
assert.equal(v1.checked, 2);

// 10. 审计链能发现篡改
const tampered = raw.replace('其余框架已删除', '其余框架仍在运行');
fs.writeFileSync(w.path, tampered);
const v2 = store.verify();
assert.equal(v2.ok, false, '篡改后应报错');
assert.ok(v2.problems.some((p) => p.code === 'hash-mismatch'));
fs.writeFileSync(w.path, raw); // 复原
assert.equal(store.verify().ok, true, '复原后应恢复完整');

// 11. 修订：旧条目标记 superseded 并置 valid_to，新条目追加到链尾
const rev = store.revise(w.id, '## 结论\n改为只保留 DSH（修订版）', '补充说明');
assert.ok(fs.existsSync(path.join(tmp, 'revisions', w.id)), '旧版应留存副本');
assert.notEqual(rev.id, w.id, '修订应产生新 id');
assert.equal(rev.supersedes, w.id);
const oldNote = store.get(w.id);
assert.equal(oldNote.meta.status, 'superseded');
assert.ok(oldNote.meta.valid_to, '被取代的旧事实应有失效日期');
assert.match(store.get(rev.id).body, /修订版/);
assert.equal(store.verify().ok, true, `修订后链应完整：${JSON.stringify(store.verify().problems)}`);
assert.equal(store.search('回滚').filter((r) => r.id === w.id).length, 0, '被取代的条目不应再出现在检索中');

// 12. 墓碑
store.forget(w.id, '测试');
assert.equal(store.search('智能体框架').filter((r) => r.id === w.id).length, 0);

// 13. 重建索引后审计链仍可校验
const n = store.rebuild();
assert.ok(n >= 2);
assert.equal(store.verify().ok, true, '重建后链应完整');

// 14. digest：常驻读取摘要
store.writeNote({
  kind: 'preferences', title: '输出用中文', body: '## 结论\n回答默认使用简体中文，简洁直接。',
  confidence: 'high', source: { agent: 'dsh' },
});
const dg = store.digest({ maxBytes: 2048 });
assert.match(dg, /^# 长期记忆摘要/);
assert.match(dg, /## 生效事实/);
assert.match(dg, /## 偏好与约定/);
assert.ok(Buffer.byteLength(dg) <= 2048, '必须在字节预算内');
assert.match(dg, /输出用中文/);

// 15. doctor 干净；坏文件能发现
assert.equal(store.doctor().ok, true, JSON.stringify(store.doctor().problems));
const bad = path.join(tmp, 'memories', 'facts', '2026-11', 'broken.md');
fs.mkdirSync(path.dirname(bad), { recursive: true });
fs.writeFileSync(bad, '---\nkind: facts\ntitle: 坏文件\n---\n没有 id 和出处\n');
const d = store.doctor();
assert.equal(d.ok, false);
assert.ok(d.problems.some((p) => p.code === 'missing-id'));
assert.ok(d.problems.some((p) => p.code === 'missing-source'));
fs.rmSync(bad);

// 16. gc 默认 dry-run
assert.equal(store.gc().dryRun, true);
store.close();

// 17. 迁移：v1 文件升级为 v2 并自动备份
const tmp2 = fs.mkdtempSync(path.join(os.tmpdir(), 'memhub-mig-'));
const oldFile = path.join(tmp2, 'memories', 'facts', '2026-01', 'old.md');
fs.mkdirSync(path.dirname(oldFile), { recursive: true });
fs.writeFileSync(oldFile, `---
id: 01LEGACY000000000000000000
kind: facts
title: 旧版记忆
created: 2026-01-01T00:00:00.000Z
updated: 2026-01-01T00:00:00.000Z
tags: [legacy]
confidence: high
source:
  agent: openclaw
schema: 1
---
## 结论
这是一条 v1 记忆。
`);
const mstore = new MemoryStore(tmp2);
assert.equal(mstore.migrate().pending, 1, 'dry-run 应报告 1 条待迁移');
const mres = mstore.migrate({ apply: true });
assert.equal(mres.migrated, 1);
const migrated = fs.readFileSync(oldFile, 'utf8');
assert.match(migrated, /schema: 2/);
assert.match(migrated, /hash: [0-9a-f]{64}/);
assert.ok(fs.existsSync(mres.backup), '应生成备份目录');
assert.equal(mstore.verify().ok, true);
mstore.close();

// 18. CLI：stats / verify 可用
const cli = path.join(import.meta.dirname, '..', 'src', 'cli.mjs');
const stats = JSON.parse(execFileSync(process.execPath, [cli, 'stats'], { env: { ...process.env, MEMORY_HOME: tmp } }).toString());
assert.ok(stats.total >= 2);
const verifyOut = JSON.parse(execFileSync(process.execPath, [cli, 'verify'], { env: { ...process.env, MEMORY_HOME: tmp } }).toString());
assert.equal(verifyOut.ok, true);

// 19. MCP：握手 / 工具 / 审计资源
const mcp = path.join(import.meta.dirname, '..', 'src', 'mcp.mjs');
const input = [
  JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }),
  JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
  JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' }),
  JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'mem_search', arguments: { query: '机器型号' } } }),
  JSON.stringify({ jsonrpc: '2.0', id: 4, method: 'resources/read', params: { uri: 'memory://audit' } }),
].join('\n') + '\n';

const res = spawnSync(process.execPath, [mcp], { input, env: { ...process.env, MEMORY_HOME: tmp }, encoding: 'utf8' });
const lines = res.stdout.trim().split('\n').map((l) => JSON.parse(l));
assert.equal(lines[0].result.serverInfo.name, 'memhub');
assert.ok(lines[1].result.tools.length >= 6);
const call = JSON.parse(lines[2].result.content[0].text);
assert.ok(Array.isArray(call), 'mem_search 应返回数组');
const audit = JSON.parse(lines[3].result.contents[0].text);
assert.ok(audit.length >= 1 && audit[0].hash, '审计资源应返回链');

fs.rmSync(tmp, { recursive: true, force: true });
fs.rmSync(tmp2, { recursive: true, force: true });
console.log('✓ 19 项冒烟测试全部通过');
