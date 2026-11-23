#!/usr/bin/env node
// MCP stdio server：把同一套工具暴露给任意 MCP 客户端。
import { MemoryStore } from './store.mjs';
import { TOOLS, callTool } from './tools.mjs';

const store = new MemoryStore();
const log = (...a) => process.stderr.write(`${a.join(' ')}\n`);

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
        serverInfo: { name: 'memhub', version: '0.4.0' },
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
        return reply(id, { content: [{ type: 'text', text: JSON.stringify(callTool(store, name, args || {}), null, 2) }] });
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
      if (uri === 'memory://index') {
        const rows = store.db.prepare('SELECT id, kind, title, anchors FROM notes WHERE tombstoned = 0 ORDER BY updated DESC').all();
        return reply(id, { contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(rows, null, 2) }] });
      }
      if (uri === 'memory://audit') {
        const chain = store.db.prepare(
          'SELECT id, kind, title, created, hash, prev_hash FROM notes WHERE hash IS NOT NULL ORDER BY created',
        ).all();
        return reply(id, { contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(chain, null, 2) }] });
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
