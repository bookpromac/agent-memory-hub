#!/usr/bin/env node
// 轻量项目管理 CLI：tasks.json 是事实源，生成看板与校验。
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const FILE = path.join(ROOT, 'planning/tasks.json');
const STATUS = ['todo', 'doing', 'review', 'done', 'blocked', 'dropped'];
const PRIORITY = ['P0', 'P1', 'P2', 'P3'];

function load() {
  const d = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  d.updated = new Date().toISOString().slice(0, 10);
  return d;
}
function save(d) { fs.writeFileSync(FILE, `${JSON.stringify(d, null, 2)}\n`); }
function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const k = a.slice(2);
      const v = argv[i + 1];
      if (v !== undefined && !v.startsWith('--')) { out[k] = v; i++; } else out[k] = true;
    } else out._.push(a);
  }
  return out;
}
function daysSince(date) {
  return Math.floor((Date.now() - new Date(date).getTime()) / 86400000);
}

function validate(d) {
  const errors = [];
  const ids = new Set();
  const epics = new Set(d.epics.map((e) => e.id));
  for (const t of d.tasks) {
    if (ids.has(t.id)) errors.push(`${t.id}: id 重复`);
    ids.add(t.id);
    if (!epics.has(t.epic)) errors.push(`${t.id}: 未知 epic ${t.epic}`);
    if (!STATUS.includes(t.status)) errors.push(`${t.id}: 非法状态 ${t.status}`);
    if (!PRIORITY.includes(t.priority)) errors.push(`${t.id}: 非法优先级 ${t.priority}`);
    if (!t.accept || !String(t.accept).trim()) errors.push(`${t.id}: 缺少验收标准`);
    if (t.status === 'blocked' && !t.blockedBy) errors.push(`${t.id}: blocked 但没写原因`);
  }
  for (const t of d.tasks) {
    for (const dep of t.deps || []) {
      if (!ids.has(dep)) errors.push(`${t.id}: 依赖 ${dep} 不存在`);
      else if (d.tasks.find((x) => x.id === dep)?.status !== 'done') {
        // 依赖未完成不一定是错误，只提示
      }
    }
  }
  return errors;
}

function nextId(d) {
  const nums = d.tasks.map((t) => Number(String(t.id).replace(/\D/g, '')) || 0);
  return `T-${String(Math.max(0, ...nums) + 1).padStart(3, '0')}`;
}

const args = parseArgs(process.argv.slice(2));
const cmd = args._[0];

if (cmd === 'list') {
  const d = load();
  let rows = d.tasks;
  if (args.status) rows = rows.filter((t) => t.status === args.status);
  if (args.epic) rows = rows.filter((t) => t.epic === args.epic);
  for (const t of rows.sort((a, b) => a.priority.localeCompare(b.priority) || a.id.localeCompare(b.id))) {
    console.log(`${t.id}  ${t.priority}  ${t.status.padEnd(7)}  ${t.epic}  ${t.title}  (${t.estimate}h)${t.blockedBy ? ` ⛔ ${t.blockedBy}` : ''}`);
  }
} else if (cmd === 'add') {
  const d = load();
  if (!args.title) { console.error('需要 --title'); process.exit(1); }
  const t = {
    id: nextId(d), epic: args.epic || 'E1', title: args.title,
    status: 'todo', priority: args.priority || 'P2',
    estimate: Number(args.estimate || 1), owner: args.owner || 'lead',
    deps: args.deps ? String(args.deps).split(',') : [],
    accept: args.accept || '', updated: new Date().toISOString().slice(0, 10),
  };
  d.tasks.push(t); save(d);
  console.log(JSON.stringify(t));
} else if (cmd === 'set') {
  const d = load();
  const t = d.tasks.find((x) => x.id === args._[1]);
  if (!t) { console.error('找不到任务'); process.exit(1); }
  for (const k of ['status', 'priority', 'title', 'estimate', 'epic', 'accept', 'owner']) {
    if (args[k] !== undefined) t[k] = k === 'estimate' ? Number(args[k]) : args[k];
  }
  if (args.blockedBy) { t.blockedBy = args.blockedBy; t.status = 'blocked'; }
  t.updated = new Date().toISOString().slice(0, 10);
  save(d);
  console.log(JSON.stringify(t));
} else if (cmd === 'check') {
  const d = load();
  const errors = validate(d);
  const stale = d.tasks.filter((t) => t.status === 'doing' && daysSince(t.updated) > 14);
  if (errors.length) { console.error(`✗ ${errors.length} 个问题`); errors.forEach((e) => console.error('  ' + e)); }
  else console.log('✓ 任务数据校验通过');
  if (stale.length) console.log(`⚠ 停滞任务：${stale.map((t) => `${t.id}(${daysSince(t.updated)}天)`).join(', ')}`);
  process.exitCode = errors.length ? 1 : 0;
} else if (cmd === 'report') {
  const d = load();
  const errors = validate(d);
  const by = (k) => d.tasks.reduce((m, t) => { m[t[k]] = (m[t[k]] || 0) + 1; return m; }, {});
  const status = by('status');
  const prio = by('priority');
  const open = d.tasks.filter((t) => !['done', 'dropped'].includes(t.status));
  const ready = open.filter((t) => t.status === 'todo' && (t.deps || []).every((dep) => d.tasks.find((x) => x.id === dep)?.status === 'done'));
  const totalHours = open.reduce((s, t) => s + (t.estimate || 0), 0);

  // BACKLOG.md
  const lines = ['# 任务清单（由 planning/tasks.json 生成，勿手改）', ''];
  for (const e of d.epics) {
    const list = d.tasks.filter((t) => t.epic === e.id);
    if (!list.length) continue;
    lines.push(`## ${e.id} ${e.name} — ${e.goal}`, '', '| ID | 任务 | 状态 | 优先级 | 估时 | 验收 |', '|---|---|---|---|---|---|');
    for (const t of list.sort((a, b) => a.priority.localeCompare(b.priority) || a.id.localeCompare(b.id))) {
      lines.push(`| ${t.id} | ${t.title}${t.blockedBy ? ` ⛔${t.blockedBy}` : ''} | ${t.status} | ${t.priority} | ${t.estimate}h | ${t.accept} |`);
    }
    lines.push('');
  }
  fs.writeFileSync(path.join(ROOT, 'planning/BACKLOG.md'), lines.join('\n'));

  // PROJECT.md 的托管区块
  const block = [
    '<!-- pm:start -->',
    '## 八、任务看板（自动生成）',
    '',
    `> 由 \`node scripts/pm.mjs report\` 生成 · 更新于 ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`,
    '',
    '| 状态 | 数量 | 优先级 | 数量 |',
    '|---|---:|---|---:|',
    `| todo | ${status.todo || 0} | P0 | ${prio.P0 || 0} |`,
    `| doing | ${status.doing || 0} | P1 | ${prio.P1 || 0} |`,
    `| review | ${status.review || 0} | P2 | ${prio.P2 || 0} |`,
    `| blocked | ${status.blocked || 0} | P3 | ${prio.P3 || 0} |`,
    `| done | ${status.done || 0} | — | — |`,
    '',
    `**待办总估时**：${totalHours}h · **可立即开始**：${ready.length} 项`,
    '',
    '### 下一步（按优先级）',
    '',
    ...ready.slice(0, 6).map((t) => `- ${t.id} ${t.priority} · ${t.title}（${t.estimate}h）`),
    ...(d.tasks.filter((t) => t.status === 'blocked').map((t) => `- ⛔ ${t.id} ${t.title} — ${t.blockedBy}`)),
    '',
    '完整清单见 [planning/BACKLOG.md](planning/BACKLOG.md)。',
    '<!-- pm:end -->',
  ].join('\n');

  const projectPath = path.join(ROOT, 'PROJECT.md');
  let project = fs.readFileSync(projectPath, 'utf8');
  if (project.includes('<!-- pm:start -->')) {
    project = project.replace(/<!-- pm:start -->[\s\S]*?<!-- pm:end -->/, block);
  } else {
    project = `${project.trimEnd()}\n\n${block}\n`;
  }
  fs.writeFileSync(projectPath, project);

  fs.writeFileSync(path.join(ROOT, 'planning/DASHBOARD.md'), `${block.replace('## 八、任务看板（自动生成）', '# 项目看板').replace(/<!-- pm:(start|end) -->/g, '')}\n`);

  console.log(JSON.stringify({ open: open.length, ready: ready.length, hours: totalHours, status, errors: errors.length }));
  if (errors.length) errors.forEach((e) => console.error('  ' + e));
} else {
  console.log('pm — 项目管理\n\n  pm list [--status todo] [--epic E3]\n  pm add --title "..." --epic E3 --priority P1 --estimate 2 --accept "..." [--deps T-001,T-002]\n  pm set T-003 --status doing | --status blocked --blockedBy "原因"\n  pm check            # 校验数据、报告停滞任务\n  pm report           # 生成 BACKLOG.md / DASHBOARD.md 并更新 PROJECT.md');
  process.exitCode = cmd ? 1 : 0;
}
