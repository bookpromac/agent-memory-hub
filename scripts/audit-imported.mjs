// 抽查导入记忆：证据有效、字段规范、近似重复、语义抽样
import fs from 'node:fs';
import path from 'node:path';
import { MemoryStore, parseFrontmatter } from '../src/store.mjs';

const home = process.env.HOME + '/Memory';
const store = new MemoryStore(home, { agent: 'hermes' });
const rows = store.db.prepare("SELECT id, title, path, confidence, source_session FROM notes WHERE owner='hermes' AND tombstoned=0").all();

// 1) 证据 session 是否存在
const validSessions = new Set();
for (const line of fs.readFileSync(process.env.HOME + '/Documents/deepseek-harness/default-workspace/imported-agents/hermes/chats/messages.jsonl', 'utf8').split('\n')) {
  if (!line.trim()) continue;
  try { validSessions.add(JSON.parse(line).session); } catch {}
}

const issues = [];
const bodies = [];
for (const r of rows) {
  const { meta, body } = parseFrontmatter(fs.readFileSync(r.path, 'utf8'));
  const ev = String(r.source_session || meta.source?.session || '').split(',').map((s) => s.trim()).filter(Boolean);
  const badEv = ev.filter((s) => !validSessions.has(s));
  if (!ev.length) issues.push({ id: r.id, issue: '无证据 session' });
  else if (badEv.length) issues.push({ id: r.id, issue: `证据不存在: ${badEv.join(',')}` });
  if (!body.includes('## 结论')) issues.push({ id: r.id, issue: '缺「## 结论」' });
  if (!body.includes('## 观察')) issues.push({ id: r.id, issue: '缺「## 观察」' });
  if (body.length > 600) issues.push({ id: r.id, issue: `正文过长 ${body.length}` });
  bodies.push({ id: r.id, title: r.title, body, conf: r.confidence });
}

// 2) 近似重复（标题+正文 trigram Jaccard）
const grams = (s) => { const t = s.replace(/\s+/g, ''); const g = new Set(); for (let i = 0; i < t.length - 2; i++) g.add(t.slice(i, i + 3)); return g; };
const dup = [];
for (let i = 0; i < bodies.length; i++) {
  for (let j = i + 1; j < bodies.length; j++) {
    const a = grams(bodies[i].title + bodies[i].body), b = grams(bodies[j].title + bodies[j].body);
    let inter = 0; for (const x of a) if (b.has(x)) inter++;
    const jac = inter / (a.size + b.size - inter || 1);
    if (jac >= 0.75) dup.push({ a: bodies[i].id, b: bodies[j].id, jac: Number(jac.toFixed(2)) });
  }
}

console.log(JSON.stringify({
  total: rows.length,
  withValidEvidence: rows.length - issues.filter((x) => x.issue.includes('证据')).length,
  issues: issues.slice(0, 10),
  issueCount: issues.length,
  nearDuplicates: dup.slice(0, 10),
  dupCount: dup.length,
  confidence: rows.reduce((m, r) => { m[r.confidence] = (m[r.confidence] || 0) + 1; return m; }, {}),
}, null, 2));

// 3) 抽样 20 条打印，供人工语义核对
const sample = bodies.slice(0, 20);
fs.writeFileSync('/tmp/audit-sample.txt', sample.map((b) => `### ${b.id} [${b.conf}]\n${b.title}\n${b.body.slice(0, 260)}\n`).join('\n'));
console.log('sampled -> /tmp/audit-sample.txt');
store.close();
