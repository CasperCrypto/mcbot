# Build

## 1. Shape

```
src/contracts/   the three contracts (zod + types) — the only shapes that cross a boundary
src/compile/     compile(graph) → files. Pure: no clock, no randomness, no fs. Byte-tested.
src/board/       the board as a Yjs doc (shared by the relay and every window)
src/app/         React UI: seven tabs, React Flow canvas, zustand UI state
engine/          one local Node process: board relay · compile writer · Hermes runner · data readers
src-tauri/       Tauri 2 shell: windows and menus only
test/            golden fixtures, real Hermes stream captures, the stub OpenAI-compatible server
```

The engine is the single writer of anything on disk. Windows are clients of
it over loopback (HTTP + one WebSocket per board), which is what makes two
windows — or two people — share one live board.

## 2. Contracts

### 2.1 Rules for all three

- They live in `src/contracts/` and are the source of truth; this section only
  summarises them.
- Change them additively. A breaking change bumps the version string
  (`mcbot.graph/v1`, `mcbot.compile/v1`, run event `v: 1`).

### 2.2 The three contracts

**2.2.1 Graph schema** — `src/contracts/graph.ts`, `schema: "mcbot.graph/v1"`

```
Graph   { schema, id, name, nodes: Node[], edges: Edge[] }
Node    { id, kind: "agent" | "model" | "tool", position: {x, y}, data }
  agent { name (Hermes profile id), displayName, description, soul, skills: Skill[] }
  model { name, label, endpoint: "local" | "cloud", baseUrl, model, apiKeyEnv, pricing | null }
  tool  { name, label, transport: "stdio" | "http", command, args, env, url, headers }
Skill   { name, description (≤ 60), version, author, license, platforms, tags, body }
Edge    { id, source, target, order }   // agent↔model or agent↔tool only;
                                        // model order 0 = primary, then the fallback chain
```

Persisted as `<workspace>/boards/<id>.json`. Semantic rules (wiring,
uniqueness, reserved names, cloud models need a key env var) are in
`src/compile/validate.ts`.

**2.2.2 Compile output layout** — `src/contracts/compile.ts`, `mcbot.compile/v1`

```
<root>/                               a Hermes home: agents run as HERMES_HOME=<root> hermes -p <agent>
  .mcbot/manifest.json                every file McBot owns, with sha256 and size
  profiles/<agent>/
    SOUL.md  config.yaml  profile.yaml  .no-bundled-skills
    skills/<skill>/SKILL.md
    memories/ sessions/ skills/ skins/ logs/ plans/ workspace/ cron/ home/
```

UTF-8, LF, one trailing newline, YAML 1.1. The same graph always yields the
same bytes. Ownership: the writer (`engine/writer.ts`) deletes only files its
previous manifest lists and refuses to write into a profile dir it did not
create. Each compile reports `added | modified | unchanged | removed` per file,
with a unified diff. The key-by-key mapping is in `docs/HERMES.md`.

**2.2.3 Run event shape** — `src/contracts/run.ts`, `v: 1`

```
{ v: 1, runId, seq, ts, type, …fields }
run.started        boardId, agentNodeId, profile, prompt, argv, hermesHome, cwd
run.session        sessionId, model
run.text           text                         (streamed delta)
run.tool.started   tool, input?, toolNodeId|null
run.tool.finished  tool, output, durationMs, isError, toolNodeId|null
run.log            stream, line                 (stderr, non-JSON stdout)
run.finished       status: succeeded|failed|interrupted, exitCode, text, tokens|null,
                   durationMs, sessionId|null, error|null
run.cost           sessionId, model, provider, reportedUsd, costStatus, estimatedUsd
```

Mapped from `hermes chat --format stream-json` (`engine/streamJson.ts`).
Persisted one per line in `<workspace>/runs/<runId>.jsonl` and pushed live on
`GET /api/events` (SSE). `toolNodeId` attributes a call to a tool node by
Hermes' `mcp__<server>__` prefix, which is how tool nodes light up on the
canvas.

## 3. Milestones

| | Scope | State |
|---|---|---|
| M0 | Tauri shell, seven tabs, canvas with agent / tool / model, JSON persistence | done |
| M1 | compile(graph) → real Hermes profile; per-file diff and hash | done |
| M2 | Yjs shared board through a local relay; live cursors, presence | done |
| M3 | run a compiled profile, stream events, paint node status | done |
| M4 | Memory and Cost from real runs | done |

Not built, on purpose: auth, SSO, databases, cloud, installers, code signing,
mobile, marketplace, templates, code editor, git, an MCP client, ACP/A2A, and
the other five node kinds (workflow, file/folder, memory, human gate,
schedule).

## 4. Verifying

```
npm test                          # unit + golden byte tests + engine integration
MCBOT_HERMES_BIN=$(which hermes) npm test   # also runs a real Hermes turn end to end
```

The integration test starts `test/stub-llm/` (deterministic OpenAI-compatible
server), compiles a board through the engine and runs it through real Hermes,
asserting the tool call, the memory write and the cost row.
