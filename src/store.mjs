// 核心存储层：Markdown 为事实源，SQLite FTS5 为可重建索引。
// 零外部依赖：仅使用 Node 内置的 node:sqlite。
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

export const KINDS = ['facts', 'preferences', 'entities', 'decisions', 'episodes'];
export const CONFIDENCE = ['high', 'medium', 'low'];
export const SCHEMA_VERSION = 1;

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** 生成 ULID：时间戳(10) + 随机(16)，可按时间排序 */
export function ulid(now = Date.now()) {
  let t = '';
  let n = now;
  for (let i = 0; i < 10; i++) {
    t = CROCKFORD[n % 32] + t;
    n = Math.floor(n / 32);
  }
  let r = '';
  const bytes = crypto.randomBytes(16);
  for (let i = 0; i < 16; i++) r += CROCKFORD[bytes[i] % 32];
  return t + r;
}

export function memoryHome() {
  return process.env.MEMORY_HOME || path.join(os.homedir(), 'Memory');
}

// ---------- frontmatter 的最小 YAML 子集 ----------

function parseScalar(v) {
  const s = String(v).trim();
  if (s === '') return '';
  if (s.startsWith('[') && s.endsWith(']')) {
    return s.slice(1, -1).split(',').map((x) => parseScalar(x)).filter((x) => x !== '');
  }
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    return s.slice(1, -1);
  }
  if (s === 'null' || s === '~') return null;
  if (s === 'true') return true;
  if (s === 'false') return false;
  return s;
}

function parseBlock(src) {
  const lines = src.split('\n');
  const out = {};
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim() || line.trim().startsWith('#')) { i++; continue; }
    const m = /^([A-Za-z0-9_-]+):\s?(.*)$/.exec(line);
    if (!m) { i++; continue; }
    const key = m[1];
    const rest = m[2];
    if (rest.trim() !== '') { out[key] = parseScalar(rest); i++; continue; }

    const items = [];
    const map = {};
    let mode = null;
    i++;
    while (i < lines.length) {
      const l = lines[i];
      if (!/^\s+/.test(l)) break;
      const t = l.trim();
      if (t.startsWith('- ')) {
        mode = 'list';
        const body = t.slice(2);
        const mm = /^([A-Za-z0-9_-]+):\s?(.*)$/.exec(body);
        if (mm) items.push({ [mm[1]]: parseScalar(mm[2]) });
        else items.push(parseScalar(body));
      } else if (mode === 'list' && items.length && typeof items[items.length - 1] === 'object') {
        const mm = /^([A-Za-z0-9_-]+):\s?(.*)$/.exec(t);
        if (mm) items[items.length - 1][mm[1]] = parseScalar(mm[2]);
      } else {
        mode = 'map';
        const mm = /^([A-Za-z0-9_-]+):\s?(.*)$/.exec(t);
        if (mm) map[mm[1]] = parseScalar(mm[2]);
      }
      i++;
    }
    out[key] = items.length ? items : map;
  }
  return out;
}

export function parseFrontmatter(raw) {
  const text = String(raw).replace(/\r\n/g, '\n');
  if (!text.startsWith('---\n')) return { meta: {}, body: text };
  const end = text.indexOf('\n---', 4);
  if (end === -1) return { meta: {}, body: text };
  const fm = text.slice(4, end);
  const body = text.slice(end + 4).replace(/^\n+/, '');
  return { meta: parseBlock(fm), body };
}

function quoteIfNeeded(v) {
  const s = String(v);
  return /[:#\-]/.test(s.slice(0, 2)) || s.includes(': ') || s === '' ? JSON.stringify(s) : s;
}

export function serialize({ meta, body }) {
  const L = ['---'];
  L.push(`id: ${meta.id}`);
  L.push(`kind: ${meta.kind}`);
  L.push(`title: ${quoteIfNeeded(meta.title)}`);
  L.push(`created: ${meta.created}`);
  L.push(`updated: ${meta.updated}`);
  L.push(`tags: [${(meta.tags || []).join(', ')}]`);
  L.push(`confidence: ${meta.confidence}`);
  if (meta.review_at) L.push(`review_at: ${meta.review_at}`);
  if (meta.status) L.push(`status: ${meta.status}`);
  if (meta.supersedes) L.push(`supersedes: ${meta.supersedes}`);
  L.push('source:');
  const src = meta.source || {};
  for (const [k, v] of Object.entries(src)) {
    if (v === undefined || v === null || v === '') continue;
    L.push(`  ${k}: ${quoteIfNeeded(v)}`);
  }
  const links = meta.links || [];
  if (links.length) {
    L.push('links:');
    for (const lk of links) {
      L.push(`  - rel: ${lk.rel}`);
      L.push(`    target: ${lk.target}`);
    }
  }
  L.push(`schema: ${SCHEMA_VERSION}`);
  L.push('---', '');
  L.push(String(body).trim(), '');
  return L.join('\n');
}

// ---------- 工具函数 ----------

export function slugify(title) {
  const s = String(title)
    .replace(/[\\/:*?"<>|\n\r\t]+/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .slice(0, 48);
  return s || 'note';
}

function sha256(s) {
  return crypto.createHash('sha256').update(s).digest('hex');
}

function writeAtomic(file, content) {
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, content, 'utf8');
  fs.renameSync(tmp, file);
}

const SECRET_PATTERNS = [
  /\bsk-[A-Za-z0-9]{16,}/,
  /\bghp_[A-Za-z0-9]{20,}/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\bBearer\s+[A-Za-z0-9._-]{20,}/,
];

export function assertNoSecrets(text) {
  for (const re of SECRET_PATTERNS) {
    if (re.test(text)) throw new Error('记忆内容疑似包含密钥，已拒绝写入');
  }
}

// ---------- 存储 ----------

export class MemoryStore {
  constructor(home = memoryHome()) {
    this.home = home;
    this.memDir = path.join(home, 'memories');
    this.dbPath = path.join(home, 'index.sqlite');
    fs.mkdirSync(this.memDir, { recursive: true });
    this.db = new DatabaseSync(this.dbPath);
    this.db.exec('PRAGMA journal_mode = WAL');
    this.db.exec('PRAGMA busy_timeout = 5000');
    this.#migrate();
  }

  #migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS notes (
        id TEXT PRIMARY KEY,
        path TEXT NOT NULL UNIQUE,
        kind TEXT NOT NULL,
        title TEXT NOT NULL,
        created TEXT NOT NULL,
        updated TEXT NOT NULL,
        confidence TEXT NOT NULL,
        review_at TEXT,
        source_agent TEXT,
        source_session TEXT,
        content_hash TEXT NOT NULL,
        tombstoned INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS links (
        from_id TEXT NOT NULL,
        rel TEXT NOT NULL,
        to_id TEXT NOT NULL,
        PRIMARY KEY (from_id, rel, to_id)
      );
      CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts USING fts5(
        id UNINDEXED, title, body, tags, tokenize = 'trigram'
      );
    `);
  }

  close() { this.db.close(); }

  #index(id, file, meta, body) {
    const tags = (meta.tags || []).join(' ');
    const tombstoned = meta.status === 'tombstoned' ? 1 : 0;
    this.db.prepare(
      `INSERT OR REPLACE INTO notes
       (id, path, kind, title, created, updated, confidence, review_at, source_agent, source_session, content_hash, tombstoned)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).run(
      id, file, meta.kind, meta.title, meta.created, meta.updated,
      meta.confidence, meta.review_at || null,
      meta.source?.agent || null, meta.source?.session || null,
      sha256(String(body).replace(/\s+/g, ' ').trim()), tombstoned,
    );
    this.db.prepare('DELETE FROM notes_fts WHERE id = ?').run(id);
    if (!tombstoned) {
      this.db.prepare('INSERT INTO notes_fts (id, title, body, tags) VALUES (?,?,?,?)')
        .run(id, meta.title, body, tags);
    }
    for (const lk of meta.links || []) {
      this.db.prepare('INSERT OR IGNORE INTO links (from_id, rel, to_id) VALUES (?,?,?)')
        .run(id, lk.rel, lk.target);
    }
  }

  writeNote({ kind, title, body, tags = [], confidence = 'medium', source = {}, links = [] }) {
    if (!KINDS.includes(kind)) throw new Error(`kind 必须是 ${KINDS.join('/')}`);
    if (!title || !String(title).trim()) throw new Error('title 不能为空');
    if (!body || !String(body).trim()) throw new Error('body 不能为空');
    if (!CONFIDENCE.includes(confidence)) throw new Error(`confidence 必须是 ${CONFIDENCE.join('/')}`);
    if (!source || !source.agent) throw new Error('source.agent 必填：没有出处的记忆不可信');
    assertNoSecrets(`${title}\n${body}`);

    const norm = String(body).replace(/\s+/g, ' ').trim();
    const hash = sha256(norm);
    const dup = this.db.prepare('SELECT id FROM notes WHERE content_hash = ? AND tombstoned = 0').get(hash);
    if (dup) return { id: dup.id, duplicate: true };

    const now = new Date().toISOString();
    const id = ulid();
    const dir = path.join(this.memDir, kind, now.slice(0, 7));
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `${slugify(title)}-${id.slice(-6)}.md`);
    const meta = {
      id, kind, title, created: now, updated: now, tags,
      confidence, source, links, schema: SCHEMA_VERSION,
    };
    writeAtomic(file, serialize({ meta, body }));
    this.#index(id, file, meta, body);
    return { id, path: file, duplicate: false };
  }

  get(idOrPath) {
    let row = this.db.prepare('SELECT * FROM notes WHERE id = ?').get(idOrPath);
    if (!row) {
      const abs = path.isAbsolute(idOrPath) ? idOrPath : path.join(this.memDir, idOrPath);
      row = this.db.prepare('SELECT * FROM notes WHERE path LIKE ?').get(`%${abs}%`);
    }
    if (!row) return null;
    const raw = fs.readFileSync(row.path, 'utf8');
    return { ...row, raw, ...parseFrontmatter(raw) };
  }

  search(query, { kinds = [], tags = [], since = null, limit = 10 } = {}) {
    const q = String(query || '').trim();
    if (!q) return [];
    const where = ['n.tombstoned = 0'];
    const params = [];
    if (kinds.length) { where.push(`n.kind IN (${kinds.map(() => '?').join(',')})`); params.push(...kinds); }
    if (since) { where.push('n.updated >= ?'); params.push(since); }

    let rows;
    if (q.length >= 3) {
      const match = `"${q.replace(/"/g, '""')}"`;
      rows = this.db.prepare(
        `SELECT n.id, n.title, n.kind, n.confidence, n.updated, n.path,
                snippet(notes_fts, 2, '[', ']', '…', 16) AS excerpt,
                bm25(notes_fts) AS score
         FROM notes_fts JOIN notes n ON n.id = notes_fts.id
         WHERE notes_fts MATCH ? AND ${where.join(' AND ')}
         ORDER BY score LIMIT ?`,
      ).all(match, ...params, limit);
    } else {
      rows = this.db.prepare(
        `SELECT n.id, n.title, n.kind, n.confidence, n.updated, n.path,
                substr(n.title, 1, 80) AS excerpt, 0 AS score
         FROM notes n WHERE (n.title LIKE ? OR n.path LIKE ?) AND ${where.join(' AND ')}
         LIMIT ?`,
      ).all(`%${q}%`, `%${q}%`, ...params, limit);
    }
    if (tags.length) {
      const keep = rows.filter((r) => {
        const raw = fs.readFileSync(r.path, 'utf8');
        const { meta } = parseFrontmatter(raw);
        return tags.every((t) => (meta.tags || []).includes(t));
      });
      rows = keep;
    }
    return rows;
  }

  recent({ limit = 10, since = null, kinds = [] } = {}) {
    const where = ['tombstoned = 0'];
    const params = [];
    if (since) { where.push('updated >= ?'); params.push(since); }
    if (kinds.length) { where.push(`kind IN (${kinds.map(() => '?').join(',')})`); params.push(...kinds); }
    return this.db.prepare(
      `SELECT id, title, kind, confidence, updated, path FROM notes
       WHERE ${where.join(' AND ')} ORDER BY updated DESC LIMIT ?`,
    ).all(...params, limit);
  }

  revise(id, body, reason = '') {
    const cur = this.get(id);
    if (!cur) throw new Error(`找不到记忆 ${id}`);
    assertNoSecrets(body);
    const revDir = path.join(this.home, 'revisions', cur.id);
    fs.mkdirSync(revDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    fs.copyFileSync(cur.path, path.join(revDir, `${stamp}.md`));

    const now = new Date().toISOString();
    const meta = { ...cur.meta, updated: now, revision_of: cur.id };
    delete meta.schema;
    if (reason) meta.source = { ...(meta.source || {}), revision_reason: reason };
    writeAtomic(cur.path, serialize({ meta, body }));
    this.#index(cur.id, cur.path, meta, body);
    return { id: cur.id, revision: stamp, path: cur.path };
  }

  forget(id, reason = '') {
    const cur = this.get(id);
    if (!cur) throw new Error(`找不到记忆 ${id}`);
    const meta = { ...cur.meta, status: 'tombstoned' };
    if (reason) meta.source = { ...(meta.source || {}), forget_reason: reason };
    writeAtomic(cur.path, serialize({ meta, body: cur.body }));
    this.db.prepare('UPDATE notes SET tombstoned = 1 WHERE id = ?').run(id);
    this.db.prepare('DELETE FROM notes_fts WHERE id = ?').run(id);
    return { id, tombstoned: true };
  }

  rebuild() {
    this.db.exec('DELETE FROM notes; DELETE FROM notes_fts; DELETE FROM links;');
    let count = 0;
    const walk = (dir) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, entry.name);
        if (entry.isDirectory()) { walk(p); continue; }
        if (!entry.name.endsWith('.md')) continue;
        const raw = fs.readFileSync(p, 'utf8');
        const { meta, body } = parseFrontmatter(raw);
        if (!meta.id) continue;
        this.#index(meta.id, p, meta, body);
        count++;
      }
    };
    walk(this.memDir);
    return count;
  }

  stats() {
    const total = this.db.prepare('SELECT COUNT(*) c FROM notes WHERE tombstoned = 0').get().c;
    const tomb = this.db.prepare('SELECT COUNT(*) c FROM notes WHERE tombstoned = 1').get().c;
    const byKind = this.db.prepare('SELECT kind, COUNT(*) c FROM notes WHERE tombstoned = 0 GROUP BY kind ORDER BY c DESC').all();
    const byAgent = this.db.prepare('SELECT source_agent a, COUNT(*) c FROM notes WHERE tombstoned = 0 GROUP BY a ORDER BY c DESC').all();
    const byConf = this.db.prepare('SELECT confidence, COUNT(*) c FROM notes WHERE tombstoned = 0 GROUP BY confidence').all();
    return { total, tombstoned: tomb, byKind, byAgent, byConfidence: byConf, home: this.home };
  }
}
