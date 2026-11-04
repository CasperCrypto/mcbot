# McBot — invariants

McBot is a desktop app (Tauri 2, macOS + Windows) where a team draws a harness
of AI agents as a graph, and the graph **compiles into a real, runnable Hermes
Agent setup on disk**. The same graph then shows what each agent is doing, what
it remembers, and what it costs.

**The compile step is the product.** If the graph does not write real files
that a real runtime reads, this is a drawing tool. Hermes Agent is the engine;
we do not modify it — we build the cockpit.

## Hard rules

1. **Never modify, patch, fork or vendor the Hermes source.** Read it to confirm
   a schema. Write only into a compile output root.
2. **Never invent a Hermes config key, path or CLI flag.** Confirm it in the
   Hermes source or with `hermes --help`, then record it with its source line in
   `docs/HERMES.md`. If you cannot verify it, stop and ask. (Hermes' own docs have
   been wrong: MCP tool names, `--source`. The code wins.)
3. **Every module in `src/compile/` has a test asserting exact bytes.** Golden
   output lives in `test/fixtures/*.expected/`; regenerate only after reviewing
   the diff (`npx tsx scripts/update-golden.ts`).
4. **Two providers only:** one local OpenAI-compatible endpoint, one cloud
   OpenAI-compatible endpoint. No per-vendor SDKs, ever.
5. Keep this file current when an invariant changes.

## The three contracts (docs/BUILD.md §2.2, code in `src/contracts/`)

1. Graph schema `mcbot.graph/v1` — `src/contracts/graph.ts`
2. Compile output layout `mcbot.compile/v1` — `src/contracts/compile.ts`
3. Run event shape `v: 1` — `src/contracts/run.ts`

Change them additively; a breaking change bumps the version.

## Compiler invariants

- `compile()` is pure and deterministic: no clock, randomness or filesystem.
  Same graph → same bytes, independent of node/edge array order.
- UTF-8, LF, one trailing newline, no BOM.
- YAML is emitted as **YAML 1.1** — Hermes parses with ruamel 1.1, where bare
  `yes/no/on/off` are booleans and `0755` is octal.
- Never write secrets. Model nodes carry an env var *name* (`key_env`).
- No `_config_version` in compiled config.yaml.
- Provider keys are `mcbot-<name>`, referenced as `custom:mcbot-<name>`.
- The writer owns exactly the files in `<root>/.mcbot/manifest.json`: it deletes
  nothing else, and refuses to write into a profile dir it did not create.
  Hermes writes `state.db`, `sessions/`, `memories/`, logs and seeded skills into
  the same dirs.

## Runtime invariants

- Agents run as `HERMES_HOME=<root> hermes -p <agent> chat --query-file - --oneshot --format stream-json`,
  cwd `<profile>/workspace`, prompt on stdin. No `--source` (Hermes rejects unknown sources).
- `hermes chat` auto-starts one gateway per root; it discovers MCP servers only
  at boot. After a compile changes a config.yaml, the engine stops it and
  **waits for the process to exit** before the next run — only for McBot's own
  root (`managedRoot`), never an external `~/.hermes`.
- MCP tools are `mcp__<server>__<tool>`; calls may arrive wrapped in `tool_call`.
- Run is refused (409) if the agent's files on disk differ from the board — compile first.
- Memory edits: Hermes' `§` format byte for byte, refused while the profile is
  running, and only against the sha256 the editor read.
- Cost comes from each profile's `state.db`; Hermes-priced vs McBot-estimated is
  always labelled. Hermes reports no GPU time — do not fabricate it.

## Shared board

- One Y.Doc per board, everything keyed by id (no Y.Array), node fields as
  separate map entries. Persisted as plain JSON by the relay; loaded loosely
  (a half-edited board is not compile-valid and must still load).
- Clients use `disableBc: true`: every edit must reach the relay, because compile
  reads the board from the relay, never from a client payload.
- The engine listens on loopback only and checks `Origin` and `Host` on every
  request and WebSocket upgrade. No auth in v0.

## Stack (do not substitute)

Tauri **2.x** (never 3, it is alpha) · React + TypeScript · React Flow
(`@xyflow/react`) · Yjs + y-websocket protocol · zod · zustand. No database, no
auth, no cloud: local JSON + the filesystem.

## Out of scope until asked

Auth, SSO, Postgres, Redis, MinIO, Langfuse, OpenTelemetry, a cloud tier,
installers, code signing, iOS, Android, a marketplace, templates, a code editor,
git integration, an MCP client, ACP, A2A, settings UI beyond what M0–M4 need.

## Commands

```
npm run dev        engine (:4317) + Vite (:5173)
npm run desktop    the Tauri app (runs `npm run dev` itself)
npm test           all tests; set MCBOT_HERMES_BIN to include a real Hermes run
npm run typecheck
npm run stub-llm   deterministic OpenAI-compatible server on :11500 for offline runs
```
