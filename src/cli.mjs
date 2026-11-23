#!/usr/bin/env node
// 命令行入口：memhub <command>
import fs from 'node:fs';
import { MemoryStore, KINDS } from './store.mjs';

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
        + '  memhub gc [--older-than 30] [--yes]   # 清理墓碑与旧修订（默认 dry-run）\n'
        + '  memhub rebuild | stats | path\n',
      );
      process.exitCode = 1;
  }
} finally {
  store?.close();
}
