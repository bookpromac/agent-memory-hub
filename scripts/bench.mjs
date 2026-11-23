// 基准：10k 条写入、索引重建、检索延迟；并发写一致性
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { MemoryStore } from '../src/store.mjs';

const N = Number(process.argv[2] || 10000);
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'memhub-bench-'));
process.env.MEMORY_HOME = home;
const store = new MemoryStore(home, { agent: 'bench' });

const t0 = Date.now();
for (let i = 0; i < N; i++) {
  store.writeNote({
    kind: ['facts', 'preferences', 'entities', 'decisions', 'episodes'][i % 5],
    title: `基准记忆 ${i} 号主题`,
    body: `## 结论\n这是第 ${i} 条基准记忆，用于测试写入与检索性能。\n## 观察\n- 序号 ${i}\n- 分类 ${i % 5}`,
    tags: ['bench', `g${i % 20}`],
    confidence: ['high', 'medium', 'low'][i % 3],
    source: { agent: 'bench', session: `s${i}` },
  });
}
const writeMs = Date.now() - t0;
store.close();

const store2 = new MemoryStore(home, { agent: 'bench' });
const t1 = Date.now();
const indexed = store2.rebuild();
const rebuildMs = Date.now() - t1;

const queries = ['基准记忆', '主题 9999', '分类 3', '序号 5000', '测试写入'];
const lat = [];
for (let i = 0; i < 100; i++) {
  const t = Date.now();
  store2.search(queries[i % queries.length], { limit: 10 });
  lat.push(Date.now() - t);
}
lat.sort((a, b) => a - b);
const p50 = lat[50]; const p95 = lat[95]; const max = lat[99];

// 并发：两个子进程各写 50 条
const child = `
const {MemoryStore}=require(${JSON.stringify(path.join(process.cwd(), 'src/store.mjs'))});
const s=new MemoryStore(process.env.H,{agent:'conc'});
for(let i=0;i<50;i++) s.writeNote({kind:'facts',title:'并发'+process.pid+'-'+i,body:'## 结论\\n并发写 '+i,source:{agent:'conc'},confidence:'high'});
s.close();
`;
const c0 = Date.now();
const ps = [1, 2].map(() => execFileSync(process.execPath, ['--input-type=module', '-e', child], { env: { ...process.env, H: home }, stdio: 'ignore' }));
const concMs = Date.now() - c0;
store2.rebuild();
const concCount = store2.db.prepare("SELECT COUNT(*) c FROM notes WHERE owner='conc'").get().c;

console.log(JSON.stringify({
  writes: { n: N, ms: writeMs, perSec: Math.round(N / (writeMs / 1000)) },
  rebuild: { indexed, ms: rebuildMs },
  search: { p50, p95, max },
  concurrency: { expected: 100, actual: concCount, ms: concMs },
  disk: { totalKB: Math.round(fs.statSync(path.join(home, 'hub/index.sqlite')).size / 1024) },
}, null, 2));

store2.close();
fs.rmSync(home, { recursive: true, force: true });
