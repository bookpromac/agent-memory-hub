// HTTP 接口层测试：鉴权、检索、写入、审计
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { MemoryStore } from '../src/store.mjs';
import { listen, ensureToken } from '../src/http.mjs';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'memhub-http-'));
process.env.MEMORY_HOME = tmp;
const store = new MemoryStore(tmp);
const { server, port, token } = await listen(store, { port: 0 });
const base = `http://127.0.0.1:${port}`;

// 1. health 无需鉴权
const health = await (await fetch(`${base}/health`)).json();
assert.equal(health.ok, true);
assert.equal(health.auth, 'bearer');

// 2. 无 token 拒绝
const unauth = await fetch(`${base}/v1/search?q=x`);
assert.equal(unauth.status, 401);

// 3. token 来自文件
assert.equal(ensureToken(tmp), token);

// 4. 写入
const w = await (await fetch(`${base}/v1/write`, {
  method: 'POST',
  headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
  body: JSON.stringify({
    kind: 'facts', title: '端口与鉴权', body: '## 观察\n- 只监听 127.0.0.1\n- 用 Bearer token 鉴权',
    source_agent: 'http-test', confidence: 'high',
  }),
})).json();
assert.ok(w.result.id);

// 5. 检索（3 字中文走 FTS）
const s = await (await fetch(`${base}/v1/search?q=鉴权&limit=5`, {
  headers: { authorization: `Bearer ${token}` },
})).json();
assert.ok(s.results.length >= 1);

// 6. 工具直调
const t = await (await fetch(`${base}/v1/tools/mem_recent`, {
  method: 'POST', headers: { authorization: `Bearer ${token}` }, body: '{}',
})).json();
assert.ok(Array.isArray(t.result));

// 7. 审计链
const a = await (await fetch(`${base}/v1/audit`, { headers: { authorization: `Bearer ${token}` } })).json();
assert.ok(a.chain.length >= 1 && a.chain[0].hash);

// 8. 非法输入 → 400
const bad = await fetch(`${base}/v1/write`, {
  method: 'POST',
  headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
  body: JSON.stringify({ kind: 'facts', title: 'x', body: 'y' }),
});
assert.equal(bad.status, 400);

// 9. 未知路径 → 404
assert.equal((await fetch(`${base}/nope`, { headers: { authorization: `Bearer ${token}` } })).status, 404);

server.close();
store.close();
fs.rmSync(tmp, { recursive: true, force: true });
console.log('✓ HTTP 接口 9 项测试通过');
