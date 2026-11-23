// DSH 记忆接管：把 DSH 会话日志沉淀为记忆，并把摘要嵌入 AGENTS.md。
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import zlib from 'node:zlib';

export function sessionsRoot() {
  return process.env.DSH_SESSIONS || path.join(os.homedir(), '.dsh', 'sessions');
}

export function agentsFile(cwd = process.cwd()) {
  return process.env.DSH_AGENTS_FILE || path.join(cwd, 'AGENTS.md');
}

function textOf(blocks = []) {
  return blocks.filter((b) => b && b.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text).join('\n').trim();
}

/** 读取一个会话文件，抽取用户与助手文本 */
export function readSession(file) {
  const raw = zlib.zstdDecompressSync(fs.readFileSync(file)).toString('utf8');
  const events = raw.split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  const head = events.find((e) => e.type === 'session') || {};
  const title = events.filter((e) => e.type === 'session/title').pop()?.data?.title || '';
  const msgs = [];
  for (const e of events) {
    if (e.type === 'user/message' && e.data?.source?.kind === 'user') {
      const t = textOf(e.data.content);
      if (t) msgs.push({ role: 'user', text: t });
    } else if (e.type === 'assistant/message') {
      const t = textOf(e.data?.content);
      if (t) msgs.push({ role: 'assistant', text: t });
    }
  }
  return {
    id: head.id || path.basename(path.dirname(file)),
    createdAt: head.createdAt || 0,
    cwd: head.cwd || '',
    title,
    msgs,
  };
}

function summarize(session, maxChars = 6000) {
  const user = session.msgs.filter((m) => m.role === 'user');
  const firstAsk = user[0]?.text?.slice(0, 60) || session.title || '未命名会话';
  const lines = [];
  let used = 0;
  // 取最后若干轮，保留上下文新鲜度
  for (const m of session.msgs.slice(-30)) {
    const text = m.text.replace(/\s+/g, ' ').slice(0, 220);
    const line = `- ${m.role === 'user' ? '问' : '答'}：${text}`;
    if (used + line.length > maxChars) break;
    lines.push(line);
    used += line.length;
  }
  return {
    title: `DSH 会话 · ${firstAsk}`,
    body: `## 结论\n${firstAsk}\n\n## 观察\n${lines.join('\n')}`,
    firstAsk,
    turns: user.length,
  };
}

/** 扫描会话目录，增量沉淀为 episodes（同一会话复用同一条记忆，变化时修订） */
export function ingest(store, { minAgeMinutes = 0, limit = 50 } = {}) {
  const root = sessionsRoot();
  if (!fs.existsSync(root)) return { scanned: 0, written: 0, revised: 0, skipped: 0, sessions: [] };

  const files = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.jsonl.zstd')) files.push(p);
    }
  };
  walk(root);

  const stats = { scanned: 0, written: 0, revised: 0, skipped: 0, sessions: [] };
  for (const file of files) {
    if (stats.scanned >= limit) break;
    const mtime = fs.statSync(file).mtimeMs;
    // minAge=0 时不应因 mtime 与当前时间的毫秒级先后而误跳过
    if (minAgeMinutes > 0 && Date.now() - mtime < minAgeMinutes * 60000) { stats.skipped++; continue; }

    let sess;
    try { sess = readSession(file); } catch { stats.skipped++; continue; }
    if (!sess.msgs.some((m) => m.role === 'user')) { stats.skipped++; continue; }
    stats.scanned++;

    const sum = summarize(sess);
    const existing = store.db.prepare(
      "SELECT id FROM notes WHERE source_session = ? AND kind = 'episodes' AND tombstoned = 0",
    ).get(sess.id);

    if (existing) {
      const cur = store.get(existing.id);
      const same = cur && cur.body.replace(/\s+/g, ' ').trim() === sum.body.replace(/\s+/g, ' ').trim();
      if (!same) {
        store.revise(existing.id, sum.body, '会话更新');
        stats.revised++;
      }
    } else {
      store.writeNote({
        kind: 'episodes',
        title: sum.title,
        body: sum.body,
        tags: ['dsh-session'],
        confidence: 'low',
        source: { agent: 'deepseek-harness', session: sess.id, trigger: 'dsh-sync' },
      });
      stats.written++;
    }
    stats.sessions.push({ id: sess.id, title: sum.title, turns: sum.turns });
  }
  return stats;
}

/** 把摘要嵌入 AGENTS.md 的托管区块（保证每次会话都在上下文里） */
export function embedDigest(digestText, file = agentsFile()) {
  const START = '<!-- memory-hub:digest:start -->';
  const END = '<!-- memory-hub:digest:end -->';
  const block = `${START}\n<!-- 由 memhub dsh sync 自动生成，勿手改 -->\n\n${digestText.trim()}\n\n${END}`;

  let cur = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '# 工作区约定\n';
  if (cur.includes(START) && cur.includes(END)) {
    const re = new RegExp(`${START}[\\s\\S]*?${END}`);
    cur = cur.replace(re, block);
  } else {
    cur = `${cur.trimEnd()}\n\n${block}\n`;
  }
  fs.writeFileSync(file, cur);
  return { file, bytes: Buffer.byteLength(block) };
}
