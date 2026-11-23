// 工具契约的唯一来源：MCP 与 HTTP 共用同一套定义与实现。
import { KINDS, CONFIDENCE } from './store.mjs';

export const TOOLS = [
  {
    name: 'mem_search',
    description: '检索长期记忆。返回命中的观察条目摘要，不是全文。',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '检索词；中文≥3 字走全文索引，2 字自动回退' },
        kinds: { type: 'array', items: { type: 'string', enum: KINDS } },
        tags: { type: 'array', items: { type: 'string' } },
        since: { type: 'string', description: 'ISO 日期，只返回此后的更新' },
        limit: { type: 'number', minimum: 1, maximum: 20 },
      },
      required: ['query'],
    },
  },
  {
    name: 'mem_get',
    description: '按 id 或相对路径读取一条记忆的完整 Markdown（含审计信息）。',
    inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
  },
  {
    name: 'mem_write',
    description: '写入一条长期记忆。source_agent 必填；内容疑似密钥会被拒绝。',
    inputSchema: {
      type: 'object',
      properties: {
        kind: { type: 'string', enum: KINDS },
        title: { type: 'string' },
        body: { type: 'string', description: 'Markdown 正文，建议含「## 结论」与「## 观察」' },
        tags: { type: 'array', items: { type: 'string' } },
        anchors: { type: 'array', items: { type: 'string' }, description: '1–3 个检索锚词' },
        confidence: { type: 'string', enum: CONFIDENCE },
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
    description: '修订一条记忆：旧条目标记 superseded，新条目追加到审计链尾。',
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

export function callTool(store, name, a = {}) {
  switch (name) {
    case 'mem_search':
      return store.search(a.query, {
        kinds: a.kinds || [], tags: a.tags || [], since: a.since || null, limit: a.limit || 10,
      });
    case 'mem_get': {
      const n = store.get(a.id);
      if (!n) throw new Error(`未找到 ${a.id}`);
      return {
        id: n.id, path: n.path, meta: n.meta, body: n.body,
        audit: n.audit,
      };
    }
    case 'mem_write':
      return store.writeNote({
        kind: a.kind, title: a.title, body: a.body,
        tags: a.tags || [], anchors: a.anchors, valid_from: a.valid_from,
        confidence: a.confidence || 'medium',
        source: { agent: a.source_agent, session: a.source_session || '', trigger: a.trigger || 'tool' },
        links: a.links || [],
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
