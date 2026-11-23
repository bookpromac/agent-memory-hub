#!/usr/bin/env node
// 零依赖 MCP stdio server：把 MemoryStore 暴露给任意 MCP 客户端。
import { MemoryStore } from './store.mjs';

const store = new MemoryStore();
const log = (...a) => process.stderr.write(`${a.join(' ')}\n`);

const TOOLS = [
  {
    name: 'mem_search',
    description: '检索长期记忆。返回摘要列表（含 id 与片段），不是全文。',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '检索词，中文≥3 字才走全文索引；更短则按标题匹配' },
        kinds: { type: 'array', items: { type: 'string', enum: ['facts', 'preferences', 'entities', 'decisions', 'episodes'] } },
        tags: { type: 'array', items: { type: 'string' } },
        since: { type: 'string', description: 'ISO 日期，只返回此后的更新' },
        limit: { type: 'number', minimum: 1, maximum: 20 },
      },
      required: ['query'],
    },
  },
  {
    name: 'mem_get',
    description: '按 id 或相对路径读取一条记忆的完整 Markdown。',
    inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
  },
  {
    name: 'mem_write',
    description: '写入一条长期记忆。source.agent 必填；内容疑似密钥会被拒绝。',
    inputSchema: {
      type: 'object',
      properties: {
        kind: { type: 'string', enum: ['facts', 'preferences', 'entities', 'decisions', 'episodes'] },
        title: { type: 'string' },
        body: { type: 'string', description: 'Markdown 正文，建议包含「## 结论」段落' },
        tags: { type: 'array', items: { type: 'string' } },
        confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
        anchors: { type: 'array', items: { type: 'string' }, description: '1–3 个检索锚词，省略则自动生成' },
        valid_from: { type: 'string', description: '事实开始为真的日期 YYYY-MM-DD' },
        source_agent: { type: 'string' },
        source_session: { type: 'string' },
        links: {
          type: 'array',
          items: { type: 'object', properties: { rel: { type: 'string' }, target: { type: 'string' } }, required: ['rel', 'target'] },
        },
      },
      required: ['kind', 'title', 'body', 'source_agent'],
    },
  },
  {
    name: 'mem_revise',
    description: '修订一条记忆：旧版本自动存入 revisions/，可回溯。',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string' }, body: { type: 'string' }, reason: { type: 'string' } },
      required: ['id', 'body'],
    },
  },
  {
    name: 'mem_recent',
    description: '最近更新的记忆，用于会话开场快速对齐。',
    inputSchema: {
      type: 'object',
      properties: { limit: { type: 'number', minimum: 1, maximum: 20 }, kinds: { type: 'array', items: { type: 'string' } } },
    },
  },
  {
    name: 'mem_forget',
    description: '将一条记忆标记为墓碑（不物理删除，可追溯）。',
    inputSchema: { type: 'object', properties: { id: { type: 'string' }, reason: { type: 'string' } }, required: ['id'] },
  },
];

function callTool(name, a = {}) {
  switch (name) {
    case 'mem_search':
      return store.search(a.query, {
        kinds: a.kinds || [], tags: a.tags || [], since: a.since || null, limit: a.limit || 10,
      });
    case 'mem_get': {
      const n = store.get(a.id);
      if (!n) throw new Error(`未找到 ${a.id}`);
      return { id: n.id, path: n.path, raw: n.raw, meta: n.meta };
    }
    case 'mem_write':
      return store.writeNote({
        kind: a.kind, title: a.title, body: a.body,
        tags: a.tags || [], confidence: a.confidence || 'medium',
        source: { agent: a.source_agent, session: a.source_session || '', trigger: 'mcp' },
        links: a.links || [], anchors: a.anchors, valid_from: a.valid_from,
      });
    case 'mem_revise':
      return store.revise(a.id, a.body, a.reason || '');
    case 'mem_recent':
      return store.recent({ limit: a.limit || 10, kinds: a.kinds || [] });
    case 'mem_forget':
      return store.forget(a.id, a.reason || '');
    default:
      throw new Error(`未知工具 ${name}`);
  }
}

function reply(id, result) { send({ jsonrpc: '2.0', id, result }); }
function fail(id, code, message) { send({ jsonrpc: '2.0', id, error: { code, message } }); }
function send(obj) { process.stdout.write(`${JSON.stringify(obj)}\n`); }

function handle(msg) {
  const { id, method, params } = msg;
  switch (method) {
    case 'initialize':
      return reply(id, {
        protocolVersion: '2025-06-18',
        capabilities: { tools: {}, resources: {} },
        serverInfo: { name: 'memhub', version: '0.1.0' },
        instructions: '长期记忆中枢。任务开始先 mem_search；结束时用 mem_write 记录可复用结论（必须填 source_agent）。',
      });
    case 'notifications/initialized':
      return undefined;
    case 'ping':
      return reply(id, {});
    case 'tools/list':
      return reply(id, { tools: TOOLS });
    case 'tools/call': {
      const { name, arguments: args } = params || {};
      try {
        const value = callTool(name, args || {});
        return reply(id, { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] });
      } catch (e) {
        return reply(id, { content: [{ type: 'text', text: `错误：${e.message}` }], isError: true });
      }
    }
    case 'resources/list':
      return reply(id, {
        resources: [
          { uri: 'memory://recent', name: '最近记忆', mimeType: 'application/json' },
          { uri: 'memory://index', name: '记忆目录', mimeType: 'application/json' },
          { uri: 'memory://audit', name: '审计链', mimeType: 'application/json' },
        ],
      });
    case 'resources/read': {
      const uri = params?.uri;
      if (uri === 'memory://recent') {
        return reply(id, { contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(store.recent({ limit: 20 }), null, 2) }] });
      }
      if (uri === 'memory://audit') {
        const chain = store.db.prepare(
          'SELECT id, kind, title, created, hash, prev_hash FROM notes WHERE hash IS NOT NULL ORDER BY created',
        ).all();
        return reply(id, { contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(chain, null, 2) }] });
      }
      if (uri === 'memory://index') {
        const rows = store.db.prepare('SELECT id, kind, title, tags FROM notes WHERE tombstoned = 0 ORDER BY updated DESC').all();
        return reply(id, { contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(rows, null, 2) }] });
      }
      return fail(id, -32602, `未知资源 ${uri}`);
    }
    default:
      if (id !== undefined) return fail(id, -32601, `未知方法 ${method}`);
      return undefined;
  }
}

let buf = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buf += chunk;
  let idx;
  while ((idx = buf.indexOf('\n')) !== -1) {
    const line = buf.slice(0, idx).trim();
    buf = buf.slice(idx + 1);
    if (!line) continue;
    try { handle(JSON.parse(line)); } catch (e) { log('parse error:', e.message); }
  }
});
process.stdin.on('end', () => { store.close(); });
log('memhub mcp server 已启动');
