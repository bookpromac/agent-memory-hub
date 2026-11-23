// 冒烟测试：覆盖写入、中文检索、去重、修订、墓碑、重建、MCP 握手
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { MemoryStore } from '../src/store.mjs';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'memhub-test-'));
process.env.MEMORY_HOME = tmp;

const store = new MemoryStore(tmp);

// 1. 写入
const w = store.writeNote({
  kind: 'decisions',
  title: '只保留一个智能体框架',
  body: '## 结论\n本机只保留 DeepSeek Harness 一个智能体框架，其余已删除。',
  tags: ['agent', 'cleanup'],
  confidence: 'high',
  source: { agent: 'dsh', session: 'test-1' },
});
assert.ok(w.id, '应返回 id');
assert.equal(w.duplicate, false);

// 2. 文件确实落盘且是 Markdown
assert.ok(fs.existsSync(w.path));
const raw = fs.readFileSync(w.path, 'utf8');
assert.match(raw, /^---\n/);
assert.match(raw, /kind: decisions/);

// 3. 中文检索（trigram）
const r1 = store.search('智能体');
assert.equal(r1.length, 1, '中文检索应命中 1 条');
assert.match(r1[0].excerpt, /\[智能体\]|智能体/);

// 4. 短词回退（<3 字）
const r2 = store.search('框架');
assert.ok(r2.length >= 1, '短词应走 LIKE 回退');

// 5. 去重
const w2 = store.writeNote({
  kind: 'decisions',
  title: '重复内容',
  body: '## 结论\n本机只保留 DeepSeek Harness 一个智能体框架，其余已删除。',
  confidence: 'high',
  source: { agent: 'dsh' },
});
assert.equal(w2.duplicate, true, '相同正文应返回既有 id');
assert.equal(w2.id, w.id);

// 6. 必填校验
assert.throws(() => store.writeNote({ kind: 'facts', title: 'x', body: 'y', source: {} }), /source.agent/);
assert.throws(() => store.writeNote({ kind: 'nope', title: 'x', body: 'y', source: { agent: 'a' } }), /kind/);
assert.throws(() => store.writeNote({ kind: 'facts', title: '', body: 'y', source: { agent: 'a' } }), /title/);

// 7. 密钥拦截
assert.throws(
  () => store.writeNote({ kind: 'facts', title: 'k', body: 'key: sk-abcdefghijklmnopqrstuvwxyz', source: { agent: 'a' } }),
  /密钥/,
);

// 8. 修订留存旧版
const rev = store.revise(w.id, '## 结论\n改为只保留 DSH（修订版）', '补充说明');
assert.ok(fs.existsSync(path.join(tmp, 'revisions', w.id)), '旧版本应留存');
const afterRevise = store.get(w.id);
assert.match(afterRevise.body, /修订版/);

// 9. 墓碑
store.forget(w.id, '测试');
assert.equal(store.search('智能体').length, 0, '墓碑后不再检索到');

// 10. 重建索引
const n = store.rebuild();
assert.ok(n >= 1, '重建应至少索引 1 条');

// 11. doctor：干净库应通过
const d1 = store.doctor();
assert.equal(d1.ok, true, `doctor 应通过，实际问题：${JSON.stringify(d1.problems)}`);

// 12. doctor：能发现坏文件
const bad = path.join(tmp, 'memories', 'facts', '2026-11', 'broken.md');
fs.mkdirSync(path.dirname(bad), { recursive: true });
fs.writeFileSync(bad, '---\nkind: facts\ntitle: 坏文件\n---\n没有 id 和出处\n');
const d2 = store.doctor();
assert.equal(d2.ok, false, 'doctor 应报错');
assert.ok(d2.problems.some((p) => p.code === 'missing-id'), '应报 missing-id');
assert.ok(d2.problems.some((p) => p.code === 'missing-source'), '应报 missing-source');
fs.rmSync(bad);

// 13. gc：默认 dry-run，不删东西
const g1 = store.gc();
assert.equal(g1.dryRun, true);
assert.equal(fs.existsSync(bad), false);
store.close();

// 11. CLI 可用
const cli = path.join(import.meta.dirname, '..', 'src', 'cli.mjs');
const out = execFileSync(process.execPath, [cli, 'stats'], { env: { ...process.env, MEMORY_HOME: tmp } });
const stats = JSON.parse(out.toString());
assert.ok(stats.home === tmp);
assert.equal(stats.tombstoned, 1);

// 12. MCP 握手 + tools/list + tools/call
const mcp = path.join(import.meta.dirname, '..', 'src', 'mcp.mjs');
const input = [
  JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }),
  JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
  JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' }),
  JSON.stringify({
    jsonrpc: '2.0', id: 3, method: 'tools/call',
    params: { name: 'mem_search', arguments: { query: '框架' } },
  }),
].join('\n') + '\n';

const res = spawnSync(process.execPath, [mcp], {
  input,
  env: { ...process.env, MEMORY_HOME: tmp },
  encoding: 'utf8',
});
const lines = res.stdout.trim().split('\n').map((l) => JSON.parse(l));
assert.equal(lines[0].result.serverInfo.name, 'memhub');
assert.ok(lines[1].result.tools.length >= 6, '应暴露 ≥6 个工具');
assert.ok(Array.isArray(lines[2].result.content), 'tools/call 应返回 content');

fs.rmSync(tmp, { recursive: true, force: true });
console.log('✓ 15 项冒烟测试全部通过');
