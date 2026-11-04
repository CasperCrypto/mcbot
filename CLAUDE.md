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

## UI invariants

- **Look:** dark, quiet, Apple-native. All colours, radii, shadows and motion are
  tokens in `src/app/styles/tokens.css`; components use tokens, not literals.
  Colour means identity (agents, node kinds) or state (running, ok, failed).
- **Less text.** No explanatory paragraphs in the UI. Labels are short; detail
  lives in tooltips (`data-tip`). Empty states are one line plus one action.
- **Everything structural is a graph.** The harness is the editable React Flow
  canvas; runs, memory and folders use the read-only `views/GraphCanvas.tsx`.
  Give each GraphCanvas a `key` per subject (root, run, agent) so React Flow
  state never leaks between subjects.
- **Faces:** agents (and people) are Blobatars with `tone={0.48}` (auto tone can
  be near-black on dark). An agent's expression is its run state: thinking,
  happy, sad.
- **Effects use block bodies.** `useEffect(() => { … })` — never a concise arrow:
  `scrollIntoView` returns a Promise in current Chromium, and an effect that
  returns a non-function crashes React on cleanup.
- Views live behind an error boundary; a broken view must not blank the window.
- **No OpenBot or Vorssaint code.** OpenBot is PolyForm Noncommercial (would make
  McBot non-commercial) and Vorssaint is GPL-3.0 with a trade-dress trademark
  policy. They are design references only. Blobatar (MIT) and Paper Shaders
  (Apache-2.0) are fine.
- **Local folders:** the engine reads only inside roots the user opened
  (`<workspace>/folders.json`), the shared files folder and compiled profiles —
  read-only, path-checked.

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
npm run build:demo browser-only demo in dist-demo/ (in-page engine, simulated runs)
```

## Browser demo and website

- `src/app/demo/` serves the engine's API inside the page for `npm run build:demo`.
  Compile there is the real compiler; runs are simulated, and the UI says so
  (the Demo chip). When an engine route changes, change the demo to match. The
  desktop build must tree-shake it out (`DEMO` is a build-time constant).
- `site/` is the website: static, no build step. `.github/workflows/site.yml`
  publishes it to GitHub Pages with the demo at `/demo/`. Download buttons read
  the latest GitHub release and show "Coming soon" until one exists.

Shortcuts: ⌘K commands · ⌘1–7 views · ⌘S compile · ⌘N new window (desktop).
