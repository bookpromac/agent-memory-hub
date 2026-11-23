// DSH 接管测试：会话沉淀 + 摘要嵌入 AGENTS.md
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { MemoryStore } from '../src/store.mjs';
import { ingest, embedDigest, readSession } from '../src/dsh.mjs';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'memhub-dsh-'));
const sessions = path.join(tmp, 'sessions');
const sessDir = path.join(sessions, 'proj', 'session-test-1');
fs.mkdirSync(sessDir, { recursive: true });

const events = [
  { type: 'session', version: 4, id: 'session-test-1', createdAt: Date.now(), cwd: '/tmp/proj' },
  { type: 'session/title', data: { title: '测试会话' } },
  { type: 'user/message', data: { content: [{ type: 'text', text: '帮我把记忆接上' }], source: { kind: 'user' } } },
  { type: 'assistant/message', data: { content: [{ type: 'text', text: '已经接好了，正在验证。' }] } },
  { type: 'user/message', data: { content: [{ type: 'text', text: '那再验证一下跨进程' }], source: { kind: 'user' } } },
  { type: 'assistant/message', data: { content: [{ type: 'text', text: 'CLI 写、MCP 读，双向都通了。' }] } },
];
const file = path.join(sessDir, 'session.v4.jsonl.zstd');
fs.writeFileSync(file, zlib.zstdCompressSync(Buffer.from(events.map((e) => JSON.stringify(e)).join('\n') + '\n')));

// 1. 解析
const sess = readSession(file);
assert.equal(sess.id, 'session-test-1');
assert.equal(sess.msgs.length, 4);

process.env.MEMORY_HOME = tmp;
process.env.DSH_SESSIONS = sessions;
const store = new MemoryStore(tmp);

// 2. 沉淀
const r1 = ingest(store, { minAgeMinutes: 0 });
assert.equal(r1.written, 1, `应写入 1 条，实际 ${JSON.stringify(r1)}`);
const row = store.db.prepare("SELECT id, source_session, confidence FROM notes WHERE kind='episodes'").get();
assert.equal(row.source_session, 'session-test-1');
assert.equal(row.confidence, 'low', '会话沉淀应为低置信度');

// 3. 幂等：再跑不重复
const r2 = ingest(store, { minAgeMinutes: 0 });
assert.equal(r2.written, 0);
assert.equal(r2.revised, 0);

// 4. 会话更新 → 修订
events.push({ type: 'assistant/message', data: { content: [{ type: 'text', text: '补充：还查了审计链。' }] } });
fs.writeFileSync(file, zlib.zstdCompressSync(Buffer.from(events.map((e) => JSON.stringify(e)).join('\n') + '\n')));
const r3 = ingest(store, { minAgeMinutes: 0 });
assert.equal(r3.revised, 1, '会话变化应触发修订');
const active = store.db.prepare("SELECT COUNT(*) c FROM notes WHERE kind='episodes' AND status='active'").get().c;
assert.equal(active, 1, '同一会话只保留一条生效记忆');
const superseded = store.db.prepare("SELECT COUNT(*) c FROM notes WHERE kind='episodes' AND status='superseded'").get().c;
assert.equal(superseded, 1, '旧版本应保留为 superseded（可追溯）');

// 5. 摘要嵌入 AGENTS.md
const agents = path.join(tmp, 'AGENTS.md');
fs.writeFileSync(agents, '# 工作区约定\n\n手写内容保留。\n');
const digestText = store.digest({ maxBytes: 4096 });
const emb = embedDigest(digestText, agents);
const content = fs.readFileSync(agents, 'utf8');
assert.match(content, /<!-- memory-hub:digest:start -->/);
assert.match(content, /<!-- memory-hub:digest:end -->/);
assert.match(content, /手写内容保留/);
assert.ok(emb.bytes > 100);

// 6. 二次嵌入不重复
embedDigest(store.digest({ maxBytes: 4096 }), agents);
const again = fs.readFileSync(agents, 'utf8');
assert.equal((again.match(/memory-hub:digest:start/g) || []).length, 1, '标记块不应重复');

// 7. 审计链仍完整
assert.equal(store.verify().ok, true);

store.close();
fs.rmSync(tmp, { recursive: true, force: true });
console.log('✓ DSH 接管 7 项测试通过');
