// 备份：仓库提交、快照、轮转、恢复
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { MemoryStore } from '../src/store.mjs';
import { ensureAgent } from '../src/hub.mjs';
import { backup, restore, listSnapshots } from '../src/backup.mjs';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'memhub-bak-'));
const store = new MemoryStore(tmp, { agent: 'alpha' });
ensureAgent(store, 'alpha');

store.writeNote({ kind: 'facts', title: '备份测试', body: '## 结论\n这条会被打包。', source: { agent: 'alpha' }, confidence: 'high' });

// 1. 首次备份：仓库被提交 + 快照生成
const r1 = backup(store, { keep: 2 });
assert.equal(r1.commits.alpha, 'committed');
assert.ok(fs.existsSync(path.join(tmp, r1.snapshot)), '快照应存在');
assert.ok(r1.bytes > 0);
assert.equal((r1.snapshot.match(/snapshot-/g) || []).length, 1);

// 2. 无变更时提交为 clean
const r2 = backup(store, { keep: 2 });
assert.equal(r2.commits.alpha, 'clean');

// 3. 轮转：keep=2，第三次后只剩 2 个
backup(store, { keep: 2 });
const snaps = listSnapshots(store);
assert.equal(snaps.length, 2, `应只保留 2 个，实际 ${snaps.length}`);

// 4. 快照内含记忆文件
const snapPath = path.join(tmp, 'backups', snaps[snaps.length - 1].file);
const listing = execFileSync('tar', ['-tzf', snapPath], { encoding: 'utf8' });
assert.ok(listing.includes('agents/alpha/memories'));

// 5. 恢复到新目录，不覆盖原库
const before = fs.readFileSync(store.get(store.db.prepare('SELECT id FROM notes LIMIT 1').get().id).path, 'utf8');
const res = restore(store, snapPath);
assert.ok(fs.existsSync(path.join(res.restoredTo, 'agents/alpha/memories')));
assert.notEqual(res.restoredTo, tmp);
assert.equal(fs.readFileSync(store.get(store.db.prepare('SELECT id FROM notes LIMIT 1').get().id).path, 'utf8'), before);

store.close();
fs.rmSync(tmp, { recursive: true, force: true });
fs.rmSync(res.restoredTo, { recursive: true, force: true });
console.log('✓ 备份 5 项测试通过');
