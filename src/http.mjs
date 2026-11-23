// HTTP 接口层：本机守护进程，供不支持 MCP 的智能体或脚本调用。
// 只监听 127.0.0.1，Bearer token 校验，token 落在 ~/Memory/.memory/token (0600)。
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { callTool } from './tools.mjs';

export function tokenPath(home) {
  return path.join(home, '.memory', 'token');
}

export function ensureToken(home) {
  const p = tokenPath(home);
  fs.mkdirSync(path.dirname(p), { recursive: true, mode: 0o700 });
  if (fs.existsSync(p)) return fs.readFileSync(p, 'utf8').trim();
  const t = crypto.randomBytes(24).toString('hex');
  fs.writeFileSync(p, `${t}\n`, { mode: 0o600 });
  return t;
}

function send(res, code, body) {
  const data = Buffer.from(`${JSON.stringify(body, null, 2)}\n`);
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'content-length': data.length });
  res.end(data);
}

function readBody(req, limit = 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(new Error('请求体过大')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function authorized(req, token) {
  const h = req.headers.authorization || '';
  const m = /^Bearer\s+(.+)$/.exec(h);
  if (!m) return false;
  const a = Buffer.from(m[1]);
  const b = Buffer.from(token);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function createServer(store, { token, version = '0.4.0' } = {}) {
  const authToken = token || ensureToken(store.home);

  return http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    const p = url.pathname;

    if (p === '/health') {
      return send(res, 200, { ok: true, version, home: store.home, auth: 'bearer' });
    }
    if (!authorized(req, authToken)) {
      return send(res, 401, { error: 'unauthorized', hint: `token 在 ${tokenPath(store.home)}` });
    }

    try {
      if (req.method === 'GET' && p === '/v1/search') {
        const q = url.searchParams.get('q') || '';
        const kinds = (url.searchParams.get('kinds') || '').split(',').filter(Boolean);
        const limit = Number(url.searchParams.get('limit') || 10);
        return send(res, 200, { results: callTool(store, 'mem_search', { query: q, kinds, limit }) });
      }

      if (req.method === 'GET' && p === '/v1/recent') {
        const limit = Number(url.searchParams.get('limit') || 10);
        return send(res, 200, { results: callTool(store, 'mem_recent', { limit }) });
      }

      if (req.method === 'GET' && p.startsWith('/v1/notes/')) {
        const id = decodeURIComponent(p.slice('/v1/notes/'.length));
        return send(res, 200, callTool(store, 'mem_get', { id }));
      }

      if (req.method === 'GET' && p === '/v1/audit') {
        const chain = store.db.prepare(
          'SELECT id, kind, title, created, hash, prev_hash FROM notes WHERE hash IS NOT NULL ORDER BY created',
        ).all();
        return send(res, 200, { chain });
      }

      if (req.method === 'POST' && p.startsWith('/v1/tools/')) {
        const name = p.slice('/v1/tools/'.length);
        const args = JSON.parse((await readBody(req)) || '{}');
        return send(res, 200, { result: callTool(store, name, args) });
      }

      if (req.method === 'POST' && (p === '/v1/write' || p === '/v1/search')) {
        const args = JSON.parse((await readBody(req)) || '{}');
        const name = p === '/v1/write' ? 'mem_write' : 'mem_search';
        return send(res, 200, { result: callTool(store, name, args) });
      }

      return send(res, 404, { error: 'not_found', path: p });
    } catch (e) {
      const isInput = /必填|不能为空|必须是|密钥|未找到/.test(e.message);
      return send(res, isInput ? 400 : 500, { error: isInput ? 'invalid_input' : 'internal', message: e.message });
    }
  });
}

export function listen(store, { port = 7710, host = '127.0.0.1' } = {}) {
  const server = createServer(store);
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      resolve({ server, port: server.address().port, token: ensureToken(store.home) });
    });
  });
}
