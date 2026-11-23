// 适配器注册表：每个智能体 = 一个接入方式 + 一段可直接粘贴的配置。
// 解决"接口不同"的问题：MCP 客户端走 stdio，脚本走 HTTP/CLI，只能导出的走文件导入。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.dirname(SRC);
const MCP_ENTRY = path.join(SRC, 'mcp.mjs');

function homePath(...p) { return path.join(os.homedir(), ...p); }

export const ADAPTERS = [
  {
    id: 'dsh',
    name: 'DeepSeek Harness',
    protocol: 'mcp',
    note: '通过 profile 的 cordis.patch.yml 挂载 dsh-mcp-client（stdio）',
    detect: () => homePath('.dsh', 'profiles', 'desktop', 'cordis.patch.yml'),
    setup: ({ memoryHome }) => `# 追加到 ~/.dsh/profiles/desktop/cordis.patch.yml
# 注意：新增行必须放在 insert: 列表里；顶层行只能覆盖已有 id
- insert:
    - id: memory-hub
      name: '@deepseek-ai/dsh-mcp-client'
      config:
        serverName: memory
        transport: stdio
        command: node
        args: ["${MCP_ENTRY}"]
        env:
          MEMORY_HOME: "${memoryHome}"
        failOnStartupError: false`,
  },
  {
    id: 'claude-code',
    name: 'Claude Code / Claude Desktop',
    protocol: 'mcp',
    note: '写入 MCP 客户端配置（mcpServers）',
    detect: () => homePath('.claude.json'),
    setup: ({ memoryHome }) => JSON.stringify({
      mcpServers: {
        memory: {
          command: 'node',
          args: [MCP_ENTRY],
          env: { MEMORY_HOME: memoryHome },
        },
      },
    }, null, 2),
  },
  {
    id: 'codex',
    name: 'Codex CLI',
    protocol: 'mcp',
    note: '写入 ~/.codex/config.toml',
    detect: () => homePath('.codex', 'config.toml'),
    setup: ({ memoryHome }) => `# 追加到 ~/.codex/config.toml
[mcp_servers.memory]
command = "node"
args = ["${MCP_ENTRY}"]
env = { MEMORY_HOME = "${memoryHome}" }`,
  },
  {
    id: 'openclaw',
    name: 'OpenClaw',
    protocol: 'mcp',
    note: 'openclaw mcp add 注册为 OpenClaw 管理的 MCP 服务器（工具名 memory__*）',
    detect: () => homePath('.openclaw', 'openclaw.json'),
    setup: ({ memoryHome }) => `# 服务名用 memhub，避免与 OpenClaw 内置 memory_search 混淆
openclaw mcp add memhub \\
  --command /opt/homebrew/bin/node \\
  --arg "${MCP_ENTRY}" \\
  --env MEMORY_HOME="${memoryHome}" \\
  --env MEMORY_AGENT=openclaw

# 验证
openclaw mcp probe memhub
# 指令文件写到 ~/.openclaw/workspace/AGENTS.md（要求先读 DIGEST、用 memory__mem_* 工具）`,
  },
  {
    id: 'cursor',
    name: 'Cursor',
    protocol: 'mcp',
    note: '写入 ~/.cursor/mcp.json',
    detect: () => homePath('.cursor', 'mcp.json'),
    setup: ({ memoryHome }) => JSON.stringify({
      mcpServers: {
        memory: { command: 'node', args: [MCP_ENTRY], env: { MEMORY_HOME: memoryHome } },
      },
    }, null, 2),
  },
  {
    id: 'http',
    name: 'HTTP（脚本 / 自定义智能体）',
    protocol: 'http',
    note: '常驻进程，curl 即可读写；只监听 127.0.0.1',
    detect: () => null,
    setup: ({ port = 7710 }) => `# 启动守护进程
memhub serve --port ${port}

# 读取 token
cat ~/Memory/.memory/token

# 检索
curl -s -H "Authorization: Bearer $TOKEN" "http://127.0.0.1:${port}/v1/search?q=关键词"

# 写入
curl -s -X POST -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' \\
  -d '{"kind":"facts","title":"标题","body":"## 观察\\n- 内容","source_agent":"my-script"}' \\
  http://127.0.0.1:${port}/v1/write`,
  },
  {
    id: 'cli',
    name: '命令行 / cron / 脚本',
    protocol: 'cli',
    note: '任何能执行 shell 的地方都能用',
    detect: () => null,
    setup: () => `# 直接调用
memhub search "关键词"
memhub write --kind episodes --title "标题" --agent my-script --body-file -

# 定时任务里也可以用环境变量覆盖库位置
MEMORY_HOME=~/Memory memhub recent --limit 5`,
  },
  {
    id: 'import',
    name: '只能导出、不给接口的智能体',
    protocol: 'file',
    note: '把导出的 JSONL/Markdown 导入为记忆（先粗导入，再蒸馏）',
    detect: () => homePath('Documents', 'deepseek-harness', 'default-workspace', 'imported-agents'),
    setup: () => `# 导入历史对话（JSONL：{session, role, time, text}）
memhub import ~/path/to/messages.jsonl --agent <来源名> --limit 200

# 导入后建议人工/模型蒸馏，再 mem_forget 掉粗糙条目`,
  },
];

export function getAdapter(id) {
  return ADAPTERS.find((a) => a.id === id) || null;
}

export function detectAdapters() {
  return ADAPTERS.map((a) => {
    let detected = false;
    let detail = '';
    try {
      const p = a.detect();
      if (p && fs.existsSync(p)) { detected = true; detail = p; }
    } catch { /* ignore */ }
    return { id: a.id, name: a.name, protocol: a.protocol, detected, detail, note: a.note };
  });
}

export function renderSetup(id, ctx = {}) {
  const a = getAdapter(id);
  if (!a) throw new Error(`未知适配器：${id}（可用：${ADAPTERS.map((x) => x.id).join(', ')}）`);
  return a.setup({ memoryHome: ctx.memoryHome || path.join(os.homedir(), 'Memory'), port: ctx.port });
}

export { REPO, MCP_ENTRY };
