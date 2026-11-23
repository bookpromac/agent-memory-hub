# Memory Hub

Cross-agent long-term memory: **Markdown is the source of truth, MCP is the protocol, and any MCP-capable agent can read and write it.**
Zero runtime dependencies (Node ≥ 22.5 for `node:sqlite`); data stays on the local machine.

## What it is

Memory Hub is a local memory service shared by multiple agents.

- **Readable source of truth.** Every memory is a Markdown file with frontmatter, not an opaque record. It can be read, diffed, and versioned with ordinary tools.
- **Derived search index.** SQLite FTS5 with the `trigram` tokenizer indexes observations, so Chinese and English text are searchable without an external service. Delete the index and rebuild it from Markdown.
- **One contract, several interfaces.** MCP (stdio), a loopback HTTP daemon, a CLI, and JSONL import share one storage core; MCP and HTTP expose the same six `mem_*` tools.
- **Append-only audit chain.** Each write links to the previous write from the same agent; `memhub verify` recomputes the hashes.
- **Multiple agent repositories.** Each agent writes to its own directory; registering an agent creates its `agent.json`, initializes an independent git repository (when git is available), and makes its shared memories eligible for the `shared/` projection.
- **Resident digest.** `memhub digest` writes a bounded summary to `~/Memory/DIGEST.md` for session startup, independent of whether the model calls a tool.

## Why

Agents change, but accumulated context should persist. Without a shared memory layer, each new agent starts from zero and cannot reuse conclusions recorded by earlier agents.

| Goal | Implementation |
|---|---|
| Human review and versioning | Markdown files in per-agent directories, with optional git versioning |
| Portable storage | MCP plus plain files; no hosted service |
| Explainable retrieval | Lexical FTS5/BM25 at observation level |
| Traceability | Required source, confidence, validity dates, hash chain |
| Reliable reading | Resident `DIGEST.md` first, `mem_search` second |

Non-goals: embedding-based semantic search, automatic fact extraction, and multi-user security. Retrieval is lexical, so a query must share tokens with indexed text; `anchors` help bridge synonyms. Identity checks prevent mistakes between local agents, not a hostile process on the same account.

## Architecture (3 layers)

```
Agents: DSH · Claude Code · Codex · scripts/cron
   │ MCP (stdio) · HTTP · CLI · JSONL import
   ▼
Interfaces: src/mcp.mjs · src/http.mjs · src/cli.mjs
   │ protocol translation only
   ▼
Tool contract: src/tools.mjs (six mem_* tools)
   │
   ▼
Core: src/store.mjs (Markdown, FTS5, audit chain)
      src/hub.mjs   (repositories, registry, projection)
   ▼
~/Memory
```

| Layer | Responsibility |
|---|---|
| Interface | Translate MCP JSON-RPC, HTTP requests, or CLI arguments into tool calls; holds no storage logic |
| Tool contract | Define names, input schemas, and behavior shared by MCP and HTTP |
| Core | Read/write Markdown, maintain the index, enforce provenance and the hash chain |

The interfaces are separate on purpose: MCP needs a long-lived stdio process, scripts need one `curl`, and imports need to stream large files. Semantics are identical everywhere.

## Requirements and install

Requires Node.js **22.5 or newer** (`node:sqlite`); CI covers Node 22, 24, and 26. git is optional; registered agent repositories are initialized with it when available. There is no `npm install`, because the package has no runtime dependencies. It is not yet published to npm.

```bash
git clone <repo-url> agent-memory-hub
cd agent-memory-hub
node --version                 # must be >= 22.5
node src/cli.mjs init
```

The data directory defaults to `~/Memory`; override it with `MEMORY_HOME`. Optionally run `npm link` to put `memhub` and `memhub-mcp` on `PATH`; the examples below use `node src/cli.mjs`, which is equivalent.

## Quickstart

```bash
# 1. Initialize (~/Memory/hub/; a repository is created on first write)
node src/cli.mjs init

# 2. Write a memory; the body is read from stdin
node src/cli.mjs write \
  --kind decisions \
  --title "Keep a single agent runtime" \
  --confidence high \
  --agent deepseek-harness \
  --session 440a6d9b \
  --tags agent,consolidation <<'EOF'
## 结论
Keep a single agent runtime on this machine.

## 观察
- Other runtimes were removed after migration.
- Export copies are kept for rollback.
EOF

# 3. Search observations
node src/cli.mjs search "single agent" --limit 5
node src/cli.mjs search "智能体" --kinds decisions,episodes --limit 5

# 4. Generate the bounded resident summary (~/Memory/DIGEST.md)
node src/cli.mjs digest
node src/cli.mjs digest --dry-run
```

The write prints the generated ULID, Markdown path, audit `hash`, and `prev_hash`. `--agent` sets both the write identity and `source.agent`; without it the source is `cli`. When `MEMORY_AGENT` is set, pass the same value to `--agent` or the write is rejected as an identity mismatch. Search results are observation-level: each result lists the statements that matched. Queries of three or more characters use the FTS5 trigram index; shorter queries fall back to `LIKE`, and a miss falls back to title matching.

The digest is ordered by priority (facts, decisions, preferences, entities, then overdue decisions) and truncated at the byte budget. It is generated content: do not edit it by hand. As of v0.9.1 its section headings are fixed Chinese strings; titles and summaries are whatever agents wrote.

## Connect an agent

### DeepSeek Harness

Add a `dsh-mcp-client` entry to `~/.dsh/profiles/desktop/cordis.patch.yml`. New entries must go inside the `insert:` list; top-level rows can only override an existing id.

```yaml
- insert:
    - id: memory-hub
      name: '@deepseek-ai/dsh-mcp-client'
      config:
        serverName: memory
        transport: stdio
        command: node
        args: ["/absolute/path/to/agent-memory-hub/src/mcp.mjs"]
        env:
          MEMORY_HOME: "/Users/you/Memory"
          MEMORY_AGENT: "deepseek-harness"
        failOnStartupError: true
```

Restart the application after adding the line; a new plugin row is not hot-loaded. Tools then appear as `mcp__memory__mem_search`, `mcp__memory__mem_write`, and so on. `MEMORY_AGENT` is optional but recommended when several agents share the store: it selects the write repository and must match the `source_agent` supplied on writes; reads are scoped to that agent plus shared repositories. Without it the identity is `default`.

### Claude Code / Claude Desktop

Add this to the client's MCP configuration (`mcpServers`):

```json
{
  "mcpServers": {
    "memory": {
      "command": "node",
      "args": ["/absolute/path/to/agent-memory-hub/src/mcp.mjs"],
      "env": {
        "MEMORY_HOME": "/Users/you/Memory",
        "MEMORY_AGENT": "claude-code"
      }
    }
  }
}
```

Any other stdio MCP client uses the same `command` and `args`. `node src/cli.mjs adapters show <id>` prints ready-to-paste configuration for the built-in adapters: `dsh`, `claude-code`, `codex`, `cursor`, `http`, `cli`, and `import`. Besides the six tools, the MCP server exposes the read-only resources `memory://recent`, `memory://index`, and `memory://audit`.

### Make the agent actually read and write

A connected tool is not a behavior. Add a memory section to the agent's instruction file (`AGENTS.md`, `CLAUDE.md`, or equivalent):

```markdown
## Memory
You have long-term memory at ~/Memory, accessed through the mem_* tools.
- At session start, read ~/Memory/DIGEST.md.
- Before non-trivial work, call mem_search("<task keywords>").
- When the task produces a reusable conclusion, call mem_write. source_agent is required.
- Never write passwords, tokens, or keys.
```

Verify end to end: ask the agent to write one memory, then find it from the CLI with `node src/cli.mjs search "<term from the new memory>"`.

## Memory model

Five kinds, all with mandatory provenance:

| Kind | Use for | Example |
|---|---|---|
| `facts` | Stable facts | Machine model, paths, account ownership |
| `preferences` | Preferences | Language, response style, formatting rules |
| `entities` | People, projects, systems | What DSH is, who owns a service |
| `decisions` | Decisions | Conclusion, reason, alternatives, impact |
| `episodes` | Conclusions from events | Root cause of an incident |

Every memory carries:

| Field | Meaning |
|---|---|
| `id`; `kind`, `title`, `body` | ULID; classification and Markdown content |
| `tags`, `anchors` | Free-form tags; 1–3 retrieval anchor terms |
| `confidence` | `high`, `medium`, or `low` |
| `source.agent` (required), `source.session` (optional) | Provenance; session or task identifier |
| `created`, `updated`; `valid_from`, `valid_to` | ISO timestamps; validity window |
| `review_at`, `status` | Governance date; `active`, `superseded`, `tombstoned`, or `archived` |
| `links`; `prev_hash`, `hash`; `schema` | Related ids; audit-chain position; schema version (4) |

### Body conventions

Two level-2 headings have special meaning. As of v0.9.1 they are matched literally in Chinese:

- `## 结论` (conclusion) — used as the digest summary. Without it, the digest uses the first 110 characters of the body.
- `## 观察` (observations) — its bullet list is split into separate indexed rows. Without it, the first 240 characters of the normalized body are indexed as one observation.

Observation-level indexing is why `mem_search` returns the precise statement that matched instead of a document-level snippet. Anchors are appended to the first observation for retrieval.

A write is rejected when the kind or confidence is invalid, the title or body is empty, `source.agent` is missing, an explicit identity targets another agent's repository, or the content matches a likely secret (`sk-…`, `ghp_…`, `AKIA…`, a private key block, or a long Bearer token). A body whose normalized SHA-256 equals an existing non-tombstoned memory returns `duplicate: true` instead of creating a second file.

## Audit chain

Each write links to the previous write from the same agent:

```
hash = sha256(JSON.stringify([
  prev_hash, id, created, source.agent, normalize(body)
]))
```

`memhub verify` recomputes every hash from the file contents and checks that each `prev_hash` exists; it reports `hash-mismatch`, `missing-predecessor`, and `multiple-roots`. A revision does not overwrite history: the old memory is marked `superseded` with a `valid_to` date, a copy is kept under `~/Memory/revisions/<id>/`, and the new memory is appended to the chain with `supersedes`. A forget writes a tombstone rather than deleting the file. The chain answers what was recorded at the time and when it was replaced by whom.

## Multi-agent repositories and shared projection

```
~/Memory/
├── agents/<id>/        agent directory; agent.json and .git once registered; memories/
├── hub/                index.sqlite (owner, repo_path, content_hash); registry.json
├── shared/             DIGEST.md; memories/<agent>/<kind>/; manifest.json
├── revisions/<id>/     pre-revision copies
├── archive/            archived files
└── backups/            snapshots created by `memhub backup`
```

The multi-agent model has three boundaries:

1. An agent writes only to `agents/<own>/`; with an explicit identity, a cross-repository write is rejected.
2. Search and recent results are scoped to the agent's own plus shared repositories; `shared/` is the supported way to see another agent's shared memories.
3. `hub/` is managed by the hub tooling; agents do not write it directly.

A write creates `agents/<id>/memories/` on demand, but registration is a separate step: only registered agents appear in `registry.json`, are initialized as git repositories when git is available, and become eligible for the shared projection. Register each id once with `memhub agents register <id>`.

`hub/registry.json` records each agent's `visibility` (`shared` or `private`) and `readScope` (`own+shared` by default). A `private` repository contributes no entries to the projection; its count is reported as `excludedPrivate`. `shared/` is generated, not a source of truth: rebuild it at any time with `memhub project`. Each projected file starts with an HTML comment naming its source path, owner, and projection time.

```bash
node src/cli.mjs agents list                              # repositories and counts
node src/cli.mjs agents register <id> --visibility shared
node src/cli.mjs project                                  # rebuild shared/
node src/cli.mjs migrate-multi --yes                      # old memories/ → agents/<id>/
```

The isolation is a local guard against mistakes, not a security boundary: any process running as the same OS user can change `MEMORY_AGENT` or edit the files. Real isolation would need separate OS users or signed records, which is out of scope.

## Commands

`memhub` below means `node src/cli.mjs` (or the linked binary).

| Command | Purpose |
|---|---|
| `memhub init` | Create the home directory and open the index |
| `memhub write --kind <kind> --title <t>` | Write a memory; body from stdin or `--body` |
| `memhub search "<query>"` | Search observations; supports `--kinds`, `--tags`, `--limit` |
| `memhub get <id\|path>` | Print full Markdown and audit information |
| `memhub recent [--limit N]` | Most recently updated memories |
| `memhub revise <id> [--reason <r>]` | Supersede a memory with a new revision |
| `memhub forget <id> [--reason <r>]` | Mark a tombstone; does not delete the file |
| `memhub digest [--dry-run]` | Generate the resident summary |
| `memhub adapters [list\|detect\|show <id>]` | Show client setup snippets |
| `memhub serve [--port 7710]` | Start the loopback HTTP daemon |
| `memhub doctor` | Check frontmatter, duplicates, broken links, index drift |
| `memhub verify` | Recompute and verify the audit chain |
| `memhub gc [--older-than N] [--yes]` | Purge old tombstones and revisions (dry-run by default) |
| `memhub rebuild` · `stats` · `path` | Rebuild the index; counts; print paths |
| `memhub backup [--keep N]` · `snapshots` · `restore <snap>` | Commit repositories, snapshot, list, restore to a separate directory |
| `memhub review` · `archive <ids>` · `health` | Find duplicates/stale/orphans; archive; report health |
| `memhub agents` · `migrate-multi` · `project` | Inspect repositories; migrate old layout; rebuild projection |
| `memhub migrate [--yes]` | Upgrade a legacy store to the current schema (backs up first) |
| `memhub import <file.jsonl> --agent <id>` | Import exported conversations as episodes |
| `memhub dsh sync` · `dsh ingest` | Refresh digest and embed it; ingest recent DSH sessions |

The HTTP daemon listens on `127.0.0.1` only. `GET /health` is unauthenticated; other endpoints require the Bearer token at `~/Memory/.memory/token`. Endpoints: `GET /v1/search`, `GET /v1/recent`, `GET /v1/notes/:id`, `GET /v1/audit`, `POST /v1/write`, `POST /v1/tools/:name` (same names and parameters as MCP).

## Testing

```bash
npm test
```

Five suites run against a temporary `MEMORY_HOME`, so the real store is untouched. The current run reports 20 smoke, 9 HTTP, 7 DSH, 9 multi-agent, and 6 governance checks. Backup and restore have a separate suite: `node test/backup.test.mjs`. CI runs the smoke suite on Node 22, 24, and 26, plus `doctor` against a fresh store.

## License

MIT. See [LICENSE](LICENSE).

## Further reading

Design docs (currently in Chinese): [FRAMEWORK](docs/FRAMEWORK.md), [multi-agent architecture](docs/ARCHITECTURE-MULTI-AGENT.md), [governance](docs/MEMORY-GOVERNANCE.md). See also [examples/](examples/) and [ROADMAP.md](ROADMAP.md).
