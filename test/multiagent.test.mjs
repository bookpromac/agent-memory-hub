// 多仓库：写隔离、跨 agent 可见性、投影、迁移
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { MemoryStore } from '../src/store.mjs';
import { ensureAgent, listAgents, project, migrateMulti, readRegistry } from '../src/hub.mjs';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'memhub-multi-'));
process.env.MEMORY_HOME = tmp;

// 1. 两个 agent 各自仓库
ensureAgent(new MemoryStore(tmp, { agent: 'alpha' }), 'alpha');
ensureAgent(new MemoryStore(tmp, { agent: 'beta' }), 'beta');
assert.ok(fs.existsSync(path.join(tmp, 'agents/alpha/memories')));
assert.ok(fs.existsSync(path.join(tmp, 'agents/beta/memories')));

const a = new MemoryStore(tmp, { agent: 'alpha' });
const b = new MemoryStore(tmp, { agent: 'beta' });

// 2. 写入落到自己仓库
const wa = a.writeNote({
  kind: 'facts', title: 'alpha 的事实', body: '## 结论\nalpha 自己的记忆。',
  source: { agent: 'alpha' }, confidence: 'high',
});
assert.ok(wa.path.includes('agents/alpha/memories'), wa.path);
assert.equal(wa.duplicate, false);

// 3. 跨仓库写被拒
assert.throws(
  () => a.writeNote({ kind: 'facts', title: '越界', body: 'x', source: { agent: 'beta' } }),
  /身份不匹配/,
);

// 4. beta 写自己的
const wb = b.writeNote({
  kind: 'facts', title: 'beta 的事实', body: '## 结论\nbeta 自己的记忆。',
  source: { agent: 'beta' }, confidence: 'high',
});
assert.ok(wb.path.includes('agents/beta/memories'));

// 5. 可见性：默认 shared → 互相可见
a.rebuild();
const seenByA = a.search('自己的记忆');
assert.ok(seenByA.some((r) => r.owner === 'beta'), 'shared 的 beta 记忆应对 alpha 可见');
const owners = new Set(seenByA.map((r) => r.owner));
assert.ok(owners.has('alpha') && owners.has('beta'));

// 6. private 不投影也不可见
let reg = readRegistry(a);
reg.agents.beta.visibility = 'private';
fs.writeFileSync(path.join(tmp, 'hub/registry.json'), JSON.stringify(reg));
const seenByA2 = a.search('自己的记忆');
assert.ok(!seenByA2.some((r) => r.owner === 'beta'), 'private 的 beta 记忆不应被 alpha 看到');

// 7. 投影只含 shared
reg = readRegistry(a);
reg.agents.beta.visibility = 'shared';
fs.writeFileSync(path.join(tmp, 'hub/registry.json'), JSON.stringify(reg));
const proj = project(a);
assert.ok(fs.existsSync(path.join(tmp, 'shared/DIGEST.md')));
assert.ok(fs.existsSync(path.join(tmp, 'shared/manifest.json')));
assert.ok(proj.copied >= 2, `投影应至少 2 条，实际 ${proj.copied}`);
assert.ok(fs.existsSync(path.join(tmp, 'shared/memories/alpha/facts')));

// 8. 迁移旧布局
const legacy = path.join(tmp, 'legacy-home');
const oldFile = path.join(legacy, 'memories', 'facts', '2026-01', 'old.md');
fs.mkdirSync(path.dirname(oldFile), { recursive: true });
fs.writeFileSync(oldFile, `---
id: 01LEGACY
kind: facts
title: 旧布局记忆
created: 2026-01-01T00:00:00.000Z
updated: 2026-01-01T00:00:00.000Z
confidence: high
source:
  agent: gamma
schema: 2
---
## 结论
旧目录里的记忆。
`);
const legacyStore = new MemoryStore(legacy, { agent: 'gamma' });
const dry = migrateMulti(legacyStore, {});
assert.equal(dry.pending, 1);
const res = migrateMulti(legacyStore, { apply: true });
assert.equal(res.migrated, 1);
assert.ok(fs.existsSync(path.join(legacy, 'agents/gamma/memories/facts/2026-01/old.md')));
assert.equal(fs.existsSync(oldFile), false);

// 9. 注册表与清单
const list = listAgents(a);
assert.ok(list.some((x) => x.id === 'alpha' && x.registered));
assert.ok(list.some((x) => x.id === 'beta'));

a.close(); b.close(); legacyStore.close();
fs.rmSync(tmp, { recursive: true, force: true });
console.log('✓ 多仓库 9 项测试通过');
