// 多仓库管理：注册表、迁移、只读投影。
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { parseFrontmatter, agentRoot } from './store.mjs';

const REGISTRY_VERSION = 1;

export function registryPath(store) {
  return path.join(store.home, 'hub', 'registry.json');
}

export function readRegistry(store) {
  const p = registryPath(store);
  if (!fs.existsSync(p)) return { version: REGISTRY_VERSION, agents: {} };
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return { version: REGISTRY_VERSION, agents: {} }; }
}

export function writeRegistry(store, reg) {
  fs.mkdirSync(path.dirname(registryPath(store)), { recursive: true });
  fs.writeFileSync(registryPath(store), `${JSON.stringify(reg, null, 2)}\n`);
}

export function ensureAgent(store, id, { displayName, visibility = 'shared', git = true } = {}) {
  const reg = readRegistry(store);
  if (reg.agents[id]) return { created: false, entry: reg.agents[id] };

  const root = agentRoot(store.home, id);
  fs.mkdirSync(path.join(root, 'memories'), { recursive: true });
  fs.writeFileSync(path.join(root, 'agent.json'), `${JSON.stringify({
    id,
    displayName: displayName || id,
    visibility,
    readScope: 'own+shared',
    createdAt: new Date().toISOString(),
  }, null, 2)}\n`);

  if (git && !fs.existsSync(path.join(root, '.git'))) {
    try {
      execFileSync('git', ['init', '-q', root], { stdio: 'ignore' });
      fs.writeFileSync(path.join(root, '.gitignore'), 'index.sqlite\n*.tmp-*\n');
      execFileSync('git', ['-C', root, 'add', '-A'], { stdio: 'ignore' });
      execFileSync('git', ['-C', root, '-c', 'user.name=memory-hub', '-c', 'user.email=hub@local', 'commit', '-qm', 'init: agent memory repo'], { stdio: 'ignore' });
    } catch { /* git 不可用不影响使用 */ }
  }

  reg.agents[id] = { displayName: displayName || id, visibility, readScope: 'own+shared', createdAt: new Date().toISOString(), repo: `agents/${id}` };
  writeRegistry(store, reg);
  return { created: true, entry: reg.agents[id] };
}

export function listAgents(store) {
  const reg = readRegistry(store);
  const dir = store.agentsDir;
  const onDisk = fs.existsSync(dir) ? fs.readdirSync(dir).filter((d) => fs.statSync(path.join(dir, d)).isDirectory()) : [];
  const ids = [...new Set([...Object.keys(reg.agents), ...onDisk])].sort();
  return ids.map((id) => {
    const root = agentRoot(store.home, id);
    const count = fs.existsSync(path.join(root, 'memories'))
      ? countMarkdown(path.join(root, 'memories')) : 0;
    return { id, registered: Boolean(reg.agents[id]), visibility: reg.agents[id]?.visibility || 'unknown', count, repo: `agents/${id}` };
  });
}

function countMarkdown(dir) {
  let n = 0;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) n += countMarkdown(p);
    else if (e.name.endsWith('.md')) n++;
  }
  return n;
}

/** 把旧的 memories/ 迁到 agents/<owner>/memories/ */
export function migrateMulti(store, { apply = false } = {}) {
  const legacy = path.join(store.home, 'memories');
  if (!fs.existsSync(legacy)) return { apply, pending: 0, owners: {}, note: '没有旧 memories/ 目录' };

  const files = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.md')) files.push(p);
    }
  };
  walk(legacy);

  const plan = [];
  const owners = {};
  for (const file of files) {
    const { meta } = parseFrontmatter(fs.readFileSync(file, 'utf8'));
    const owner = meta.source?.agent || 'default';
    const rel = path.relative(legacy, file);
    plan.push({ file, owner, rel });
    owners[owner] = (owners[owner] || 0) + 1;
  }

  if (!apply) return { apply, pending: plan.length, owners, note: '加上 --yes 才真正迁移' };

  for (const { file, owner, rel } of plan) {
    ensureAgent(store, owner, { displayName: owner, git: true });
    const dest = path.join(agentRoot(store.home, owner), 'memories', rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.renameSync(file, dest);
  }

  // 清理空的旧目录
  const rmEmpty = (dir) => {
    if (!fs.existsSync(dir)) return;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.isDirectory()) rmEmpty(path.join(dir, e.name));
    }
    if (fs.readdirSync(dir).length === 0) fs.rmdirSync(dir);
  };
  rmEmpty(legacy);

  const indexed = store.rebuild();
  return { apply: true, migrated: plan.length, owners, indexed };
}

/** 生成 shared/ 只读投影 */
export function project(store, { owners = null } = {}) {
  const reg = readRegistry(store);
  const names = owners || Object.keys(reg.agents).filter((a) => (reg.agents[a].visibility || 'shared') === 'shared');
  const sharedDir = path.join(store.home, 'shared');
  const memDir = path.join(sharedDir, 'memories');
  fs.rmSync(memDir, { recursive: true, force: true });
  fs.mkdirSync(memDir, { recursive: true });

  const rows = store.db.prepare(
    `SELECT id, owner, path, kind, title, status FROM notes
     WHERE tombstoned = 0 AND (status IS NULL OR status = 'active')`,
  ).all();

  const counts = {};
  let excludedPrivate = 0;
  let copied = 0;
  for (const r of rows) {
    if (!names.includes(r.owner)) { excludedPrivate++; continue; }
    const src = r.path;
    if (!fs.existsSync(src)) continue;
    const body = fs.readFileSync(src, 'utf8');
    const header = `<!-- source: ${path.relative(store.home, src)} -->\n<!-- owner: ${r.owner} · projected: ${new Date().toISOString()} -->\n\n`;
    const destDir = path.join(memDir, r.owner, r.kind);
    fs.mkdirSync(destDir, { recursive: true });
    fs.writeFileSync(path.join(destDir, path.basename(src)), header + body);
    counts[r.owner] = (counts[r.owner] || 0) + 1;
    copied++;
  }

  const digest = store.digest({ owners: names, maxBytes: 4096, bare: true });
  const sharedDigest = [
    '# 共享记忆摘要（跨智能体只读投影）',
    '',
    `> 生成于 ${new Date().toISOString().slice(0, 16).replace('T', ' ')} · 来源 agent：${names.join(', ') || '无'}`,
    '> 本文件是生成物，权威内容在各 agent 仓库；请勿手改。',
    '',
    digest,
  ].join('\n');
  fs.writeFileSync(path.join(sharedDir, 'DIGEST.md'), sharedDigest);

  fs.writeFileSync(path.join(sharedDir, 'manifest.json'), `${JSON.stringify({
    generatedAt: new Date().toISOString(),
    agents: names,
    counts,
    copied,
    excludedPrivate,
  }, null, 2)}\n`);

  return { shared: sharedDir, agents: names, counts, copied, excludedPrivate };
}
