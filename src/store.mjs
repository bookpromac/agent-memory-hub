// 核心存储层 v2：Markdown 事实源 + SQLite FTS5 索引 + 哈希审计链。
// 零外部依赖：仅使用 Node 内置的 node:sqlite。
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

export const KINDS = ['facts', 'preferences', 'entities', 'decisions', 'episodes'];
export const CONFIDENCE = ['high', 'medium', 'low'];
export const SCHEMA_VERSION = 2;

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

export function ulid(now = Date.now()) {
  let t = '';
  let n = now;
  for (let i = 0; i < 10; i++) { t = CROCKFORD[n % 32] + t; n = Math.floor(n / 32); }
  const bytes = crypto.randomBytes(16);
  let r = '';
  for (let i = 0; i < 16; i++) r += CROCKFORD[bytes[i] % 32];
  return t + r;
}

export function memoryHome() {
  return process.env.MEMORY_HOME || path.join(os.homedir(), 'Memory');
}

// ---------- frontmatter 最小 YAML 子集 ----------

function parseScalar(v) {
  const s = String(v).trim();
  if (s === '') return '';
  if (s.startsWith('[') && s.endsWith(']')) {
    return s.slice(1, -1).split(',').map((x) => parseScalar(x)).filter((x) => x !== '');
  }
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) return s.slice(1, -1);
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
  return { meta: parseBlock(text.slice(4, end)), body: text.slice(end + 4).replace(/^\n+/, '') };
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
  if (meta.valid_from) L.push(`valid_from: ${meta.valid_from}`);
  if (meta.valid_to) L.push(`valid_to: ${meta.valid_to}`);
  L.push(`tags: [${(meta.tags || []).join(', ')}]`);
  L.push(`anchors: [${(meta.anchors || []).join(', ')}]`);
  L.push(`confidence: ${meta.confidence}`);
  if (meta.review_at) L.push(`review_at: ${meta.review_at}`);
  if (meta.status) L.push(`status: ${meta.status}`);
  if (meta.supersedes) L.push(`supersedes: ${meta.supersedes}`);
  const src = meta.source || {};
  if (Object.keys(src).length) {
    L.push('source:');
    for (const [k, v] of Object.entries(src)) {
      if (v === undefined || v === null || v === '') continue;
      L.push(`  ${k}: ${quoteIfNeeded(v)}`);
    }
  }
  const links = meta.links || [];
  if (links.length) {
    L.push('links:');
    for (const lk of links) { L.push(`  - rel: ${lk.rel}`); L.push(`    target: ${lk.target}`); }
  }
  if (meta.prev_hash !== undefined) L.push(`prev_hash: ${meta.prev_hash || '""'}`);
  if (meta.hash) L.push(`hash: ${meta.hash}`);
  L.push(`schema: ${meta.schema || SCHEMA_VERSION}`);
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

export function sha256(s) {
  return crypto.createHash('sha256').update(s).digest('hex');
}

function normalizeBody(body) {
  return String(body).replace(/\s+/g, ' ').trim();
}

/** 审计链哈希：可从文件字段完整复算 */
export function noteHash({ prev_hash = '', id, created, agent = '', body }) {
  return sha256(JSON.stringify([prev_hash || '', id, created, agent || '', normalizeBody(body)]));
}

/** 从正文提取「## 观察」下的条目；没有则整篇作为一条观察 */
export function observationsOf(body) {
  const text = String(body);
  const m = /^##\s*观察\s*$/m.exec(text);
  if (!m) {
    const firstPara = normalizeBody(text).slice(0, 240);
    return [{ ord: 0, text: firstPara || '（空）' }];
  }
  const rest = text.slice(m.index + m[0].length);
  const next = /^##\s+/m.exec(rest);
  const block = next ? rest.slice(0, next.index) : rest;
  const out = [];
  for (const line of block.split('\n')) {
    const b = /^\s*[-*]\s+(.*)$/.exec(line);
    if (b && b[1].trim()) out.push({ ord: out.length, text: b[1].trim() });
  }
  if (!out.length) return [{ ord: 0, text: normalizeBody(block).slice(0, 240) || '（空）' }];
  return out;
}

/** 无模型时的锚词启发式：标题分片 + 标签 */
export function deriveAnchors(title, tags = []) {
  const parts = String(title).split(/[\s，,、:：()（）\[\]【】]+/).filter((s) => s.length >= 2);
  const set = new Set([...parts.slice(0, 2), ...tags.slice(0, 2)]);
  return [...set].slice(0, 3);
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
  for (const re of SECRET_PATTERNS) if (re.test(text)) throw new Error('记忆内容疑似包含密钥，已拒绝写入');
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
        valid_from TEXT,
        valid_to TEXT,
        confidence TEXT NOT NULL,
        review_at TEXT,
        source_agent TEXT,
        source_session TEXT,
        anchors TEXT,
        prev_hash TEXT,
        hash TEXT,
        status TEXT,
        tombstoned INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS links (
        from_id TEXT NOT NULL, rel TEXT NOT NULL, to_id TEXT NOT NULL,
        PRIMARY KEY (from_id, rel, to_id)
      );
      CREATE TABLE IF NOT EXISTS observations (
        doc_id TEXT NOT NULL, ord INTEGER NOT NULL, text TEXT NOT NULL,
        PRIMARY KEY (doc_id, ord)
      );
      CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
      CREATE VIRTUAL TABLE IF NOT EXISTS obs_fts USING fts5(
        doc_id UNINDEXED, ord UNINDEXED, text, tokenize = 'trigram'
      );
    `);
  }

  close() { this.db.close(); }

  #meta(key, fallback = null) {
    const r = this.db.prepare('SELECT value FROM meta WHERE key = ?').get(key);
    return r ? r.value : fallback;
  }

  #setMeta(key, value) {
    this.db.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?,?)').run(key, String(value));
  }

  #indexNote({ id, file, meta, body, hash, prev_hash }) {
    const tombstoned = meta.status === 'tombstoned' ? 1 : 0;
    this.db.prepare(
      `INSERT OR REPLACE INTO notes
       (id, path, kind, title, created, updated, valid_from, valid_to, confidence, review_at,
        source_agent, source_session, anchors, prev_hash, hash, status, tombstoned)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).run(
      id, file, meta.kind, meta.title, meta.created, meta.updated,
      meta.valid_from || null, meta.valid_to || null,
      meta.confidence, meta.review_at || null,
      meta.source?.agent || null, meta.source?.session || null,
      (meta.anchors || []).join(' '), prev_hash || null, hash || null, meta.status || 'active', tombstoned,
    );

    this.db.prepare('DELETE FROM observations WHERE doc_id = ?').run(id);
    this.db.prepare('DELETE FROM obs_fts WHERE doc_id = ?').run(id);
    if (!tombstoned) {
      const obs = observationsOf(body);
      const ins = this.db.prepare('INSERT INTO observations (doc_id, ord, text) VALUES (?,?,?)');
      const insFts = this.db.prepare('INSERT INTO obs_fts (doc_id, ord, text) VALUES (?,?,?)');
      for (const o of obs) {
        ins.run(id, o.ord, o.text);
        // 锚词并入该文档首条观察的检索文本，提升同义召回
        const extra = o.ord === 0 && (meta.anchors || []).length ? ` ${meta.anchors.join(' ')}` : '';
        insFts.run(id, o.ord, o.text + extra);
      }
    }

    this.db.prepare('DELETE FROM links WHERE from_id = ?').run(id);
    for (const lk of meta.links || []) {
      this.db.prepare('INSERT OR IGNORE INTO links (from_id, rel, to_id) VALUES (?,?,?)').run(id, lk.rel, lk.target);
    }
  }

  writeNote({ kind, title, body, tags = [], anchors, confidence = 'medium', source = {}, links = [], valid_from, supersedes }) {
    if (!KINDS.includes(kind)) throw new Error(`kind 必须是 ${KINDS.join('/')}`);
    if (!title || !String(title).trim()) throw new Error('title 不能为空');
    if (!body || !String(body).trim()) throw new Error('body 不能为空');
    if (!CONFIDENCE.includes(confidence)) throw new Error(`confidence 必须是 ${CONFIDENCE.join('/')}`);
    if (!source || !source.agent) throw new Error('source.agent 必填：没有出处的记忆不可信');
    assertNoSecrets(`${title}\n${body}`);

    const norm = normalizeBody(body);
    for (const c of this.db.prepare('SELECT id, path, hash FROM notes WHERE tombstoned = 0').all()) {
      const { body: existing } = parseFrontmatter(fs.readFileSync(c.path, 'utf8'));
      if (normalizeBody(existing) === norm) {
        return { id: c.id, path: c.path, hash: c.hash, duplicate: true };
      }
    }

    const now = new Date().toISOString();
    const id = ulid();
    const prev_hash = this.#meta('chain_head', '');
    const anchorList = (anchors && anchors.length ? anchors : deriveAnchors(title, tags)).slice(0, 3);
    const hash = noteHash({ prev_hash, id, created: now, agent: source.agent, body });
    const dir = path.join(this.memDir, kind, now.slice(0, 7));
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `${slugify(title)}-${id.slice(-6)}.md`);
    const meta = {
      id, kind, title, created: now, updated: now,
      valid_from: valid_from || now.slice(0, 10), tags, anchors: anchorList,
      confidence, source, links, prev_hash, hash, schema: SCHEMA_VERSION,
      ...(supersedes ? { supersedes } : {}),
    };
    writeAtomic(file, serialize({ meta, body }));
    this.db.exec('BEGIN IMMEDIATE');
    this.#indexNote({ id, file, meta, body, hash, prev_hash });
    this.#setMeta('chain_head', hash);
    this.#setMeta('chain_len', Number(this.#meta('chain_len', 0)) + 1);
    this.db.exec('COMMIT');
    return { id, path: file, hash, prev_hash, duplicate: false };
  }

  get(idOrPath) {
    let row = this.db.prepare('SELECT * FROM notes WHERE id = ?').get(idOrPath);
    if (!row) {
      const abs = path.isAbsolute(idOrPath) ? idOrPath : path.join(this.memDir, idOrPath);
      row = this.db.prepare('SELECT * FROM notes WHERE path LIKE ?').get(`%${abs}%`);
    }
    if (!row) return null;
    const raw = fs.readFileSync(row.path, 'utf8');
    const parsed = parseFrontmatter(raw);
    const next = this.db.prepare('SELECT id FROM notes WHERE prev_hash = ?').get(row.hash);
    return {
      ...row, raw, ...parsed,
      audit: {
        hash: row.hash, prev_hash: row.prev_hash,
        next_id: next?.id || null, legacy: !row.hash,
      },
    };
  }

  search(query, { kinds = [], tags = [], since = null, limit = 10 } = {}) {
    const q = String(query || '').trim();
    if (!q) return [];
    const docLimit = Math.max(limit * 5, 40);
    let hits = [];
    if (q.length >= 3) {
      hits = this.db.prepare(
        `SELECT doc_id, ord, text, bm25(obs_fts) AS score
         FROM obs_fts WHERE obs_fts MATCH ? ORDER BY score LIMIT ?`,
      ).all(`"${q.replace(/"/g, '""')}"`, docLimit);
    } else {
      // trigram 至少要 3 字；中文两字词（项目/部署/回滚）走观察表 LIKE 回退
      hits = this.db.prepare(
        `SELECT o.doc_id, o.ord, o.text, 0 AS score
         FROM observations o JOIN notes n ON n.id = o.doc_id
         WHERE n.tombstoned = 0 AND (n.status IS NULL OR n.status = 'active') AND o.text LIKE ? LIMIT ?`,
      ).all(`%${q}%`, docLimit);
    }

    const byDoc = new Map();
    for (const h of hits) {
      const n = this.db.prepare('SELECT * FROM notes WHERE id = ?').get(h.doc_id);
      if (!n || n.tombstoned || n.status === 'superseded') continue;
      if (kinds.length && !kinds.includes(n.kind)) continue;
      if (since && n.updated < since) continue;
      const arr = byDoc.get(h.doc_id) || { note: n, hits: [] };
      if (arr.hits.length < 3) arr.hits.push({ ord: h.ord, text: h.text, score: h.score });
      byDoc.set(h.doc_id, arr);
    }

    let results = [...byDoc.values()]
      .sort((a, b) => a.hits[0].score - b.hits[0].score)
      .slice(0, limit)
      .map(({ note, hits: hs }) => ({
        id: note.id, title: note.title, kind: note.kind, confidence: note.confidence,
        updated: note.updated, anchors: (note.anchors || '').split(' ').filter(Boolean),
        hits: hs, excerpt: hs[0]?.text?.slice(0, 160) || '',
      }));

    if (!results.length) {
      // 短词或未命中：标题回退
      results = this.db.prepare(
        `SELECT id, title, kind, confidence, updated, anchors FROM notes
         WHERE tombstoned = 0 AND (status IS NULL OR status = 'active') AND title LIKE ? LIMIT ?`,
      ).all(`%${q}%`, limit).map((n) => ({
        id: n.id, title: n.title, kind: n.kind, confidence: n.confidence,
        updated: n.updated, anchors: (n.anchors || '').split(' ').filter(Boolean),
        hits: [], excerpt: n.title,
      }));
    }

    if (tags.length) {
      results = results.filter((r) => {
        const { meta } = parseFrontmatter(this.db.prepare('SELECT path FROM notes WHERE id = ?').get(r.id).path
          ? fs.readFileSync(this.db.prepare('SELECT path FROM notes WHERE id = ?').get(r.id).path, 'utf8')
          : '');
        return tags.every((t) => (meta.tags || []).includes(t));
      });
    }
    return results;
  }

  recent({ limit = 10, since = null, kinds = [] } = {}) {
    const where = ["tombstoned = 0 AND (status IS NULL OR status = 'active')"];
    const params = [];
    if (since) { where.push('updated >= ?'); params.push(since); }
    if (kinds.length) { where.push(`kind IN (${kinds.map(() => '?').join(',')})`); params.push(...kinds); }
    return this.db.prepare(
      `SELECT id, title, kind, confidence, updated, anchors FROM notes
       WHERE ${where.join(' AND ')} ORDER BY updated DESC LIMIT ?`,
    ).all(...params, limit).map((n) => ({ ...n, anchors: (n.anchors || '').split(' ').filter(Boolean) }));
  }

  /** 修订 = 旧条目标记 superseded + 追加一条新记忆（保持链式追加，不破坏审计） */
  revise(id, body, reason = '') {
    const cur = this.get(id);
    if (!cur) throw new Error(`找不到记忆 ${id}`);
    assertNoSecrets(body);

    const revDir = path.join(this.home, 'revisions', cur.id);
    fs.mkdirSync(revDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    fs.copyFileSync(cur.path, path.join(revDir, `${stamp}.md`));

    // 旧条目：标记被取代，内容不动（哈希不变）
    const oldMeta = {
      ...cur.meta,
      status: 'superseded',
      valid_to: new Date().toISOString().slice(0, 10),
      updated: new Date().toISOString(),
    };
    if (reason) oldMeta.source = { ...(oldMeta.source || {}), revision_reason: reason };
    writeAtomic(cur.path, serialize({ meta: oldMeta, body: cur.body }));
    this.db.exec('BEGIN IMMEDIATE');
    this.#indexNote({ id: cur.id, file: cur.path, meta: oldMeta, body: cur.body, hash: cur.hash, prev_hash: cur.prev_hash });
    this.db.exec('COMMIT');

    const created = this.writeNote({
      kind: cur.meta.kind,
      title: cur.meta.title,
      body,
      tags: cur.meta.tags || [],
      anchors: cur.meta.anchors || [],
      confidence: cur.meta.confidence,
      source: { ...(cur.meta.source || {}), revision_of: cur.id },
      links: cur.meta.links || [],
      supersedes: cur.id,
    });
    return { id: created.id, supersedes: cur.id, hash: created.hash, revision: stamp };
  }

  forget(id, reason = '') {
    const cur = this.get(id);
    if (!cur) throw new Error(`找不到记忆 ${id}`);
    const meta = { ...cur.meta, status: 'tombstoned', valid_to: cur.meta.valid_to || new Date().toISOString().slice(0, 10) };
    if (reason) meta.source = { ...(meta.source || {}), forget_reason: reason };
    writeAtomic(cur.path, serialize({ meta, body: cur.body }));
    this.db.prepare('UPDATE notes SET tombstoned = 1 WHERE id = ?').run(id);
    this.db.prepare('DELETE FROM obs_fts WHERE doc_id = ?').run(id);
    this.db.prepare('DELETE FROM observations WHERE doc_id = ?').run(id);
    return { id, tombstoned: true };
  }

  rebuild() {
    this.db.exec('DELETE FROM notes; DELETE FROM obs_fts; DELETE FROM observations; DELETE FROM links; DELETE FROM meta;');
    let count = 0;
    const files = [];
    const walk = (dir) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, entry.name);
        if (entry.isDirectory()) { walk(p); continue; }
        if (entry.name.endsWith('.md')) files.push(p);
      }
    };
    walk(this.memDir);

    for (const file of files) {
      const raw = fs.readFileSync(file, 'utf8');
      const { meta, body } = parseFrontmatter(raw);
      if (!meta.id) continue;
      this.#indexNote({
        id: meta.id, file, meta, body,
        hash: meta.hash || null, prev_hash: meta.prev_hash || null,
      });
      count++;
    }

    // 恢复链头：找出没有任何笔记以它的 hash 作为 prev_hash 的那条
    const rows = this.db.prepare('SELECT hash, prev_hash FROM notes WHERE hash IS NOT NULL').all();
    const referenced = new Set(rows.map((r) => r.prev_hash).filter(Boolean));
    const heads = rows.filter((r) => !referenced.has(r.hash));
    if (heads.length === 1) this.#setMeta('chain_head', heads[0].hash);
    this.#setMeta('chain_len', rows.length);
    return count;
  }

  /** 校验哈希链：每条笔记的 hash 必须可由字段复算，且 prev_hash 必须存在于链中 */
  verify() {
    const rows = this.db.prepare('SELECT * FROM notes WHERE hash IS NOT NULL ORDER BY created').all();
    const byHash = new Map(rows.map((r) => [r.hash, r]));
    const problems = [];
    let checked = 0;
    for (const r of rows) {
      const raw = fs.readFileSync(r.path, 'utf8');
      const { meta, body } = parseFrontmatter(raw);
      const expect = noteHash({
        prev_hash: meta.prev_hash || '', id: meta.id, created: meta.created,
        agent: meta.source?.agent, body,
      });
      checked++;
      if (expect !== meta.hash) problems.push({ level: 'error', code: 'hash-mismatch', id: r.id, path: r.path });
      if (meta.prev_hash && !byHash.has(meta.prev_hash)) {
        problems.push({ level: 'error', code: 'missing-predecessor', id: r.id });
      }
    }
    const legacy = this.db.prepare('SELECT COUNT(*) c FROM notes WHERE hash IS NULL').get().c;
    return { ok: problems.length === 0, checked, legacy, problems };
  }

  /** 把 v1 笔记升级为 v2：补 valid_from / anchors / prev_hash / hash */
  migrate({ apply = false } = {}) {
    const files = [];
    const walk = (dir) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, entry.name);
        if (entry.isDirectory()) { walk(p); continue; }
        if (entry.name.endsWith('.md')) files.push(p);
      }
    };
    walk(this.memDir);

    const pending = files
      .map((file) => ({ file, raw: fs.readFileSync(file, 'utf8') }))
      .map(({ file, raw }) => ({ file, raw, ...parseFrontmatter(raw) }))
      .filter(({ meta }) => !meta.hash || Number(meta.schema || 1) < SCHEMA_VERSION)
      .sort((a, b) => String(a.meta.created).localeCompare(String(b.meta.created)));

    if (!apply) return { apply: false, pending: pending.length };
    if (!pending.length) return { apply: true, migrated: 0 };

    const dir = path.join(this.home, 'backups', `pre-v2-${new Date().toISOString().replace(/[:.]/g, '-')}`);
    fs.mkdirSync(dir, { recursive: true });

    let prev = this.#meta('chain_head', '');
    for (const item of pending) {
      fs.copyFileSync(item.file, path.join(dir, path.basename(item.file)));
      const meta = { ...item.meta };
      meta.valid_from = meta.valid_from || String(meta.created).slice(0, 10);
      meta.anchors = meta.anchors?.length ? meta.anchors : deriveAnchors(meta.title, meta.tags || []);
      meta.prev_hash = prev;
      meta.hash = noteHash({ prev_hash: prev, id: meta.id, created: meta.created, agent: meta.source?.agent, body: item.body });
      meta.schema = SCHEMA_VERSION;
      writeAtomic(item.file, serialize({ meta, body: item.body }));
      prev = meta.hash;
    }
    this.rebuild();
    return { apply: true, migrated: pending.length, backup: dir };
  }

  doctor() {
    const problems = [];
    const files = [];
    const walk = (dir) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, entry.name);
        if (entry.isDirectory()) { walk(p); continue; }
        if (entry.name.endsWith('.md')) files.push(p);
      }
    };
    walk(this.memDir);

    const seenBody = new Map();
    const ids = new Set();
    for (const file of files) {
      const raw = fs.readFileSync(file, 'utf8');
      const { meta, body } = parseFrontmatter(raw);
      const rel = path.relative(this.home, file);
      if (!meta.id) problems.push({ level: 'error', code: 'missing-id', file: rel });
      if (!KINDS.includes(meta.kind)) problems.push({ level: 'error', code: 'bad-kind', file: rel, value: meta.kind });
      if (!meta.title) problems.push({ level: 'error', code: 'missing-title', file: rel });
      if (!CONFIDENCE.includes(meta.confidence)) problems.push({ level: 'warn', code: 'bad-confidence', file: rel });
      if (!meta.source?.agent) problems.push({ level: 'error', code: 'missing-source', file: rel });
      if (!meta.hash) problems.push({ level: 'warn', code: 'legacy-no-hash', file: rel });
      if (meta.id) ids.add(meta.id);
      const h = sha256(normalizeBody(body));
      if (seenBody.has(h)) problems.push({ level: 'warn', code: 'duplicate', file: rel, other: seenBody.get(h) });
      else seenBody.set(h, rel);
    }

    for (const file of files) {
      const { meta } = parseFrontmatter(fs.readFileSync(file, 'utf8'));
      for (const lk of meta.links || []) {
        if (!ids.has(lk.target)) problems.push({ level: 'warn', code: 'broken-link', file: path.relative(this.home, file), target: lk.target });
      }
    }

    const rows = this.db.prepare('SELECT id, path FROM notes').all();
    const indexed = new Set(rows.map((r) => r.path));
    for (const file of files) {
      if (!indexed.has(file)) problems.push({ level: 'error', code: 'not-indexed', file: path.relative(this.home, file) });
    }
    for (const r of rows) {
      if (!fs.existsSync(r.path)) problems.push({ level: 'error', code: 'missing-file', file: r.path });
    }

    const errors = problems.filter((p) => p.level === 'error').length;
    return { ok: errors === 0, files: files.length, indexed: rows.length, problems };
  }

  gc({ olderThanDays = 30, dryRun = true } = {}) {
    const cutoff = new Date(Date.now() - olderThanDays * 86400000).toISOString();
    const tombs = this.db.prepare('SELECT id, path FROM notes WHERE tombstoned = 1 AND updated < ?').all(cutoff);
    const revDir = path.join(this.home, 'revisions');
    const revs = [];
    if (fs.existsSync(revDir)) {
      for (const id of fs.readdirSync(revDir)) {
        const d = path.join(revDir, id);
        if (!fs.statSync(d).isDirectory()) continue;
        for (const f of fs.readdirSync(d)) {
          const p = path.join(d, f);
          if (fs.statSync(p).mtime.toISOString() < cutoff) revs.push(p);
        }
      }
    }

    let freed = 0;
    if (!dryRun) {
      for (const t of tombs) {
        try { freed += fs.statSync(t.path).size; fs.rmSync(t.path); } catch { /* 已不存在 */ }
        this.db.prepare('DELETE FROM notes WHERE id = ?').run(t.id);
      }
      for (const r of revs) {
        try { freed += fs.statSync(r).size; fs.rmSync(r); } catch { /* ignore */ }
      }
      for (const id of fs.existsSync(revDir) ? fs.readdirSync(revDir) : []) {
        const d = path.join(revDir, id);
        if (fs.statSync(d).isDirectory() && fs.readdirSync(d).length === 0) fs.rmdirSync(d);
      }
    }
    return { dryRun, olderThanDays, tombstones: tombs.length, revisions: revs.length, freedBytes: freed };
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
