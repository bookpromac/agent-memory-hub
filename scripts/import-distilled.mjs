// 把子代理提炼的记忆写入 hermes 仓库（去重 + 校验）
import fs from 'node:fs';
import path from 'node:path';
import { MemoryStore } from '../src/store.mjs';

const dir = process.argv[2] || '/tmp/mem-distill';
const files = fs.readdirSync(dir).filter((f) => /^out-batch-\d+\.json$/.test(f)).sort();
if (!files.length) { console.error('没有找到 out-batch-*.json'); process.exit(1); }

let all = [];
for (const f of files) {
  const raw = fs.readFileSync(path.join(dir, f), 'utf8');
  let data;
  try { data = JSON.parse(raw); } catch (e) { console.error(`${f} 解析失败: ${e.message}`); continue; }
  if (!Array.isArray(data)) { console.error(`${f} 不是数组`); continue; }
  all.push(...data);
  console.log(`${f}: ${data.length} 条`);
}

const KINDS = new Set(['facts', 'preferences', 'entities', 'decisions', 'episodes']);
const CONF = new Set(['high', 'medium', 'low']);
const norm = (s) => String(s).replace(/\s+/g, '').toLowerCase();

// 校验
const valid = [];
for (const m of all) {
  if (!m || !KINDS.has(m.kind) || !m.title || !m.body || !CONF.has(m.confidence)) continue;
  valid.push(m);
}

// 近似去重：标题 3-gram Jaccard ≥ 0.6 视为同一条，保留信息更长的那条
function grams(s) {
  const t = norm(s);
  const g = new Set();
  for (let i = 0; i < t.length - 2; i++) g.add(t.slice(i, i + 3));
  return g;
}
function jaccard(a, b) {
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter || 1);
}

const kept = [];
for (const m of valid) {
  const g = grams(m.title);
  const dup = kept.find((k) => jaccard(grams(k.title), g) >= 0.6);
  if (dup) {
    if (m.body.length > dup.body.length) Object.assign(dup, m);
    continue;
  }
  kept.push(m);
}

console.log(`原始 ${all.length} · 有效 ${valid.length} · 去重后 ${kept.length}`);

const store = new MemoryStore(process.env.HOME + '/Memory', { agent: 'hermes' });
let written = 0;
let duplicate = 0;
for (const m of kept) {
  try {
    const res = store.writeNote({
      kind: m.kind,
      title: m.title.slice(0, 60),
      body: m.body,
      tags: [...new Set([...(m.tags || []), 'imported', 'hermes'])].slice(0, 6),
      confidence: m.confidence,
      source: { agent: 'hermes', session: m.evidence || '', trigger: 'history-distill' },
    });
    if (res.duplicate) duplicate++; else written++;
  } catch (e) {
    console.error('写入失败:', m.title, e.message);
  }
}
console.log(JSON.stringify({ written, duplicate, total: kept.length }));
store.close();
