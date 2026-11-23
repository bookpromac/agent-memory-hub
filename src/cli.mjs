#!/usr/bin/env node
// 命令行入口：memhub <command>
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { MemoryStore, KINDS } from './store.mjs';
import { listen } from './http.mjs';
import { ADAPTERS, detectAdapters, renderSetup, getAdapter } from './adapters.mjs';

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('--')) { out[key] = next; i++; }
      else out[key] = true;
    } else out._.push(a);
  }
  return out;
}

function readBody(args) {
  if (args['body-file']) return fs.readFileSync(args['body-file'], 'utf8');
  if (args.body) return String(args.body);
  if (!process.stdin.isTTY) return fs.readFileSync(0, 'utf8');
  return '';
}

function print(obj) { process.stdout.write(`${JSON.stringify(obj, null, 2)}\n`); }

const cmd = process.argv[2];
const args = parseArgs(process.argv.slice(3));
const store = cmd ? new MemoryStore() : null;

try {
  switch (cmd) {
    case 'init': {
      print({ ok: true, home: store.home, kinds: KINDS });
      break;
    }
    case 'write': {
      const body = readBody(args);
      const tags = args.tags ? String(args.tags).split(',').map((s) => s.trim()).filter(Boolean) : [];
      const res = store.writeNote({
        kind: args.kind || 'episodes',
        title: args.title || body.split('\n')[0].slice(0, 60),
        body,
        tags,
        confidence: args.confidence || 'medium',
        source: {
          agent: args.agent || 'cli',
          session: args.session || '',
          trigger: args.trigger || 'manual',
        },
        links: args.link ? [{ rel: args.rel || 'about', target: args.link }] : [],
        anchors: args.anchors ? String(args.anchors).split(',').map((x) => x.trim()).filter(Boolean) : undefined,
        valid_from: args['valid-from'] || undefined,
      });
      print(res);
      break;
    }
    case 'search': {
      const q = args._.join(' ') || args.q || '';
      print(store.search(q, {
        kinds: args.kinds ? String(args.kinds).split(',') : [],
        tags: args.tags ? String(args.tags).split(',') : [],
        limit: Number(args.limit || 10),
        since: args.since || null,
      }));
      break;
    }
    case 'get': {
      const note = store.get(args._[0]);
      if (!note) { print({ error: 'not found' }); process.exitCode = 1; break; }
      process.stdout.write(note.raw);
      break;
    }
    case 'recent': {
      print(store.recent({ limit: Number(args.limit || 10) }));
      break;
    }
    case 'revise': {
      const body = readBody(args);
      print(store.revise(args._[0], body, args.reason || ''));
      break;
    }
    case 'forget': {
      print(store.forget(args._[0], args.reason || ''));
      break;
    }
    case 'digest': {
      const text = store.digest({ maxBytes: Number(args['max-bytes'] || 4096) });
      if (args['dry-run']) { process.stdout.write(text); break; }
      const out = args.out || path.join(store.home, 'DIGEST.md');
      fs.writeFileSync(out, text);
      print({ written: out, bytes: Buffer.byteLength(text), hint: '在 AGENTS.md / CLAUDE.md 里要求「先读 DIGEST.md」' });
      break;
    }
    case 'serve': {
      const port = Number(args.port || 7710);
      const { port: actual, token } = await listen(store, { port });
      print({
        ok: true,
        url: `http://127.0.0.1:${actual}`,
        token_file: path.join(store.home, '.memory', 'token'),
        token_preview: `${token.slice(0, 6)}…`,
        note: '按 Ctrl+C 停止',
      });
      break;
    }
    case 'adapters': {
      const sub = args._[0] || 'list';
      if (sub === 'detect') { print(detectAdapters()); break; }
      if (sub === 'show') {
        const id = args._[1];
        const a = getAdapter(id);
        if (!a) { print({ error: `未知适配器 ${id}`, available: ADAPTERS.map((x) => x.id) }); process.exitCode = 1; break; }
        print({ id: a.id, name: a.name, protocol: a.protocol, note: a.note, setup: renderSetup(id, { memoryHome: store.home, port: args.port }) });
        break;
      }
      print(detectAdapters());
      break;
    }
    case 'import': {
      const file = args._[0];
      if (!file) { print({ error: '用法：memhub import <messages.jsonl> --agent <name> [--limit 200]' }); process.exitCode = 1; break; }
      const agent = args.agent || 'import';
      const limit = Number(args.limit || 200);
      const counts = { sessions: 0, written: 0, skipped: 0 };
      const groups = new Map();
      const rl = readline.createInterface({ input: fs.createReadStream(file, 'utf8'), crlfDelay: Infinity });
      for await (const line of rl) {
        if (!line.trim()) continue;
        let row;
        try { row = JSON.parse(line); } catch { continue; }
        const sid = row.session || 'unknown';
        if (!groups.has(sid)) groups.set(sid, []);
        groups.get(sid).push(row);
      }
      for (const [sid, rows] of groups) {
        if (counts.sessions >= limit) break;
        counts.sessions++;
        const body = rows
          .slice(-40)
          .map((r) => `- ${r.role || '?'}: ${String(r.text || '').slice(0, 300).replace(/\n/g, ' ')}`)
          .join('\n')
          .slice(0, 8000);
        const res = store.writeNote({
          kind: 'episodes',
          title: `导入会话 ${sid}`,
          body: `## 观察\n${body}`,
          tags: ['import', agent],
          confidence: 'low',
          source: { agent, session: sid, trigger: 'import' },
        });
        if (res.duplicate) counts.skipped++; else counts.written++;
      }
      print({ file, agent, ...counts });
      break;
    }
    case 'rebuild': {
      print({ indexed: store.rebuild() });
      break;
    }
    case 'doctor': {
      const res = store.doctor();
      print(res);
      if (!res.ok) process.exitCode = 1;
      break;
    }
    case 'verify': {
      const res = store.verify();
      print(res);
      if (!res.ok) process.exitCode = 1;
      break;
    }
    case 'migrate': {
      print(store.migrate({ apply: Boolean(args.yes || args.apply) }));
      break;
    }
    case 'gc': {
      print(store.gc({
        olderThanDays: Number(args['older-than'] || 30),
        dryRun: !(args.yes || args.apply),
      }));
      break;
    }
    case 'stats': {
      print(store.stats());
      break;
    }
    case 'path': {
      print({ home: store.home, memories: store.memDir, index: store.dbPath });
      break;
    }
    default:
      process.stderr.write(
        'memhub — 跨智能体记忆中枢\n\n'
        + '  memhub init\n'
        + '  memhub write --kind decisions --title "标题" --body-file - --agent dsh [--tags a,b] [--confidence high]\n'
        + '  memhub search "关键词" [--kinds decisions,episodes] [--limit 5]\n'
        + '  memhub get <id|path>\n'
        + '  memhub recent [--limit 10]\n'
        + '  memhub revise <id> --body-file - --reason "为何改"\n'
        + '  memhub forget <id> --reason "为何弃用"\n'
        + '  memhub doctor                 # 体检：frontmatter/重复/断链/索引漂移\n'
        + '  memhub verify                 # 校验哈希审计链\n'
        + '  memhub migrate [--yes]        # v1 → v2 升级（默认 dry-run，自动备份）\n'
        + '  memhub gc [--older-than 30] [--yes]   # 清理墓碑与旧修订（默认 dry-run）\n'
        + '  memhub digest [--dry-run] [--max-bytes 4096]   # 生成常驻读取摘要\n'
        + '  memhub serve [--port 7710]    # 启动本机 HTTP 守护进程\n'
        + '  memhub adapters [list|detect|show <id>]   # 各智能体的接入方式\n'
        + '  memhub import <file.jsonl> --agent <name> [--limit 200]\n'
        + '  memhub rebuild | stats | path\n',
      );
      process.exitCode = 1;
  }
} finally {
  // serve 需要保持进程与数据库句柄存活
  if (cmd !== 'serve') store?.close();
}
