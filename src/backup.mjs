// 备份与恢复：提交各 agent 仓库 + 打包快照 + 轮转保留
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const GIT = ['-c', 'user.name=memory-hub', '-c', 'user.email=hub@local'];

export function commitAgentRepos(store) {
  const dir = store.agentsDir;
  if (!fs.existsSync(dir)) return {};
  const result = {};
  for (const agent of fs.readdirSync(dir)) {
    const repo = path.join(dir, agent);
    if (!fs.existsSync(path.join(repo, '.git'))) continue;
    try {
      execFileSync('git', ['-C', repo, 'add', '-A'], { stdio: 'ignore' });
      const dirty = execFileSync('git', ['-C', repo, 'status', '--porcelain'], { encoding: 'utf8' }).trim();
      if (!dirty) { result[agent] = 'clean'; continue; }
      execFileSync('git', ['-C', repo, ...GIT, 'commit', '-qm', `memory: ${new Date().toISOString().slice(0, 16)}`], { stdio: 'ignore' });
      result[agent] = 'committed';
    } catch (e) {
      result[agent] = `error: ${e.message.split('\n')[0]}`;
    }
  }
  return result;
}

export function backup(store, { keep = 7 } = {}) {
  const commits = commitAgentRepos(store);
  const dir = path.join(store.home, 'backups');
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 23);
  const out = path.join(dir, `snapshot-${stamp}.tar.gz`);
  execFileSync('tar', [
    '-czf', out,
    '-C', store.home,
    '--exclude', 'backups',
    '--exclude', '*.tmp-*',
    '--exclude', '.memory/token',
    '.',
  ], { stdio: 'ignore' });

  const snaps = fs.readdirSync(dir).filter((f) => /^snapshot-.*\.tar\.gz$/.test(f)).sort();
  const removed = [];
  while (snaps.length > keep) { const f = snaps.shift(); fs.rmSync(path.join(dir, f)); removed.push(f); }

  return {
    commits,
    snapshot: path.relative(store.home, out),
    bytes: fs.statSync(out).size,
    kept: snaps.length,
    pruned: removed,
  };
}

export function restore(store, snapshot, { to = null } = {}) {
  const file = path.isAbsolute(snapshot) ? snapshot : path.join(store.home, snapshot);
  if (!fs.existsSync(file)) throw new Error(`快照不存在：${snapshot}`);
  const target = to || `${store.home}-restored-${new Date().toISOString().replace(/[:]/g, '-').slice(0, 19)}`;
  fs.mkdirSync(target, { recursive: true });
  execFileSync('tar', ['-xzf', file, '-C', target], { stdio: 'ignore' });
  return { restoredTo: target, from: file };
}

export function listSnapshots(store) {
  const dir = path.join(store.home, 'backups');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((f) => f.endsWith('.tar.gz'))
    .sort()
    .map((f) => ({ file: f, bytes: fs.statSync(path.join(dir, f)).size, mtime: fs.statSync(path.join(dir, f)).mtime.toISOString() }));
}
