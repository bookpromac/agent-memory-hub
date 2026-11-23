// 治理：review / archive / health
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { MemoryStore } from '../src/store.mjs';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'memhub-gov-'));
const store = new MemoryStore(tmp, { agent: 'alpha' });

const a = store.writeNote({ kind: 'facts', title: '磁盘是 SSD', body: '## 结论\n本机使用固态硬盘。\n## 观察\n- 容量 460G', source: { agent: 'alpha' }, confidence: 'high' });
const b = store.writeNote({ kind: 'facts', title: '磁盘为固态', body: '## 结论\n本机使用固态硬盘 SSD。\n## 观察\n- 容量 460G', source: { agent: 'alpha' }, confidence: 'high' });
const c = store.writeNote({ kind: 'decisions', title: '采用多仓库', body: '## 结论\n每个 agent 独立仓库。', source: { agent: 'alpha' }, confidence: 'medium' });

// 1. review 检出近似重复
const rv = store.review({ dupThreshold: 0.7 });
assert.ok(rv.counts.duplicates >= 1, `应检出重复，实际 ${JSON.stringify(rv.counts)}`);

// 2. 使用计数影响评分
const before = store.score(store.db.prepare('SELECT * FROM notes WHERE id=?').get(a.id));
store.touch(a.id);
const after = store.score(store.db.prepare('SELECT * FROM notes WHERE id=?').get(a.id));
assert.ok(after > before, '使用后评分应上升');
assert.equal(store.usageOf(a.id).uses, 1);

// 3. health 指标结构
const h = store.health({ digestBytes: 100 });
assert.ok(h.total >= 3 && h.active >= 3);
assert.equal(typeof h.usedRate, 'number');
assert.ok(h.byOwner.alpha >= 3);

// 4. archive dry-run 不动文件
const dry = store.archive([c.id], { dryRun: true });
assert.equal(dry.dryRun, true);
assert.ok(fs.existsSync(c.path));

// 5. archive 实跑：移动 + 状态 + 检索排除
const res = store.archive([c.id], { dryRun: false });
assert.equal(res.actions.length, 1);
assert.equal(fs.existsSync(c.path), false, '原路径应已移走');
const archivedPath = path.join(tmp, res.actions[0].to);
assert.ok(fs.existsSync(archivedPath), '归档路径应存在');
assert.equal(store.get(c.id).meta.status, 'archived');
assert.equal(store.search('多仓库').filter((r) => r.id === c.id).length, 0, '归档后默认不检索');

// 6. 归档文件仍可读
const raw = fs.readFileSync(archivedPath, 'utf8');
assert.match(raw, /status: archived/);
assert.match(raw, /每个 agent 独立仓库/);

store.close();
fs.rmSync(tmp, { recursive: true, force: true });
console.log('✓ 治理 6 项测试通过');
