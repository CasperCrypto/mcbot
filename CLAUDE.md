# McBot — invariants

McBot is a desktop app (Tauri 2, macOS + Windows) where a team draws a harness
of AI agents as a graph, and the graph **compiles into a real, runnable Hermes
Agent setup on disk**. The same graph then shows what each agent is doing, what
it remembers, and what it costs.

**The compile step is the product.** If the graph does not write real files
that a real runtime reads, this is a drawing tool. Hermes Agent is the engine
and ships inside McBot: one download, nothing else to install. What merges into
McBot and what is rebuilt is decided in `docs/MERGE.md`.

## Hard rules

1. **Merge only code we may ship under MIT.** McBot is MIT. MIT, Apache-2.0 and
   BSD code can come in, with its `LICENSE` and notices kept: Hermes Agent (MIT,
   forked into `hermes/`) and Buzz (Apache-2.0). Never copy code under a
   noncommercial, source-available or copyleft licence (PolyForm, Sustainable Use,
   GPL): rebuild those features.
   Changes inside `hermes/` stay small and marked, so upstream updates still merge,
   and each one is also a patch file in `patches/hermes/` (`npm run engine:patches --
   make <checkout>` after changing hermes/; `npm test` fails if a patch is not applied).
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
  cwd `<profile>/workspace`, prompt on stdin. McBot's own Hermes adds `--source mcbot`;
  an external one gets no `--source` (upstream rejects unknown sources).
- `hermes chat` auto-starts one gateway per root; it discovers MCP servers only
  at boot. After a compile changes a config.yaml, the engine stops it and
  **waits for the process to exit** before the next run — only for McBot's own
  root (`managedRoot`), never an external `~/.hermes`.
- MCP tools are `mcp__<server>__<tool>`; calls may arrive wrapped in `tool_call`.
- An agent's abilities compile to `platform_toolsets.cli` (unset = Hermes' default:
  everything but video and the task board); a wired image/video maker compiles to
  `image_gen` / `video_gen` and turns its tool set on. Makers are Hermes' own
  provider plugins: McBot only names one and its key variable, so hard rule 4 (two
  chat-model providers, no vendor SDKs in McBot) still holds.
- A chat app node (Telegram) is one bot for one agent. Its token (saved in McBot
  under the node's `tokenEnv`) and allowed users go into that agent's `.env` as
  `TELEGRAM_BOT_TOKEN` / `TELEGRAM_ALLOWED_USERS`; only an own Bot API server is
  compiled (`platforms.telegram.extra.base_url`). The engine refreshes agents'
  `.env` after a compile, a saved key, a board save and at start, and runs
  `hermes gateway ensure` while any compiled agent has a bot with a saved token.
  No allowed users = nobody can message it (Hermes refuses unknown senders).
- Run is refused (409) if the agent's files on disk differ from the board — compile first.
- Memory edits: Hermes' `§` format byte for byte, refused while the profile is
  running, and only against the sha256 the editor read.
- Cost comes from each profile's `state.db`; Hermes-priced vs McBot-estimated is
  always labelled. Hermes reports no GPU time — do not fabricate it.
- API keys typed into McBot live in `<workspace>/secrets.json` (owner-only); boards
  and compiled files carry only the variable's name, and the engine never returns a
  key's value. Hermes' gateway reads a served profile's keys from `<profile>/.env`
  only (never its own environment), so before each run (and after a compile, a saved
  key or a board save) the engine writes the keys that agent's board names (models,
  makers, `${env:NAME}` in MCP servers, chat-app tokens) into
  a marked McBot block of that `.env`, owner-only, keeping every other line
  (`engine/profileEnv.ts`). Compile never writes keys. The Files view never lists or
  shows `.env` / `.op.env`. Saving a key restarts McBot's own gateway. (OS keychain in M6.)
- McBot runs **its own Hermes** (`hermes/`, our fork) unless `MCBOT_HERMES_BIN` names
  another: Hermes' own Python from its tool store (`HERMES_RUNTIME_DIR`, default
  `hermes/.hermes-runtime`) running the `hermes` launcher, with the environment
  `python -m pm.environments --format json` gives for that Hermes home, composed
  once per home and reused (`prepareHermes`). A home without Hermes' dependencies
  gets `setup-hermes.sh --runtime-only` (`setup-hermes.ps1 -RuntimeOnly` on Windows)
  first. No bash needed, so Windows works the same way. Its runs carry
  `--source mcbot`; an external Hermes gets no `--source`. A run that meets
  "Gateway starting/draining" is retried once (a new home's gateway boots slowly).
  Runs never set `HERMES_MANAGED` (a managed install stops creating its home's
  folders); `npm run cli` does, so `hermes update` says updates come with McBot.
  Changes inside `hermes/` are listed in `hermes/MCBOT.md`; upstream releases come
  in with `npm run engine:sync`, which also lists upstream files Hermes'
  `.gitignore` hides (add them with `git add -f`).
- First launch runs the setup assistant (`src/app/setup/`): its answers go into
  every agent's SOUL.md and their USER.md memory; `<workspace>/setup.json`
  records that it ran. Local model servers are found by asking the usual
  addresses for `/v1/models` (Ollama :11434, LM Studio :1234).

## The installed app

- One download: the Tauri shell, `mcbot-engine` (the engine as a Node single
  executable, `scripts/build-engine.mjs`, Tauri `externalBin`) and Hermes as a
  resource (`scripts/stage-hermes.mjs`: only git-tracked files of `hermes/`).
  `tauri build` runs all three (`beforeBuildCommand`).
- In release builds the shell starts the engine with `MCBOT_HERMES_BUNDLE` and
  `MCBOT_DATA_DIR` and kills it on quit; `tauri dev` runs `npm run dev` instead.
  The engine copies the read-only Hermes to `<data>/hermes-<stamp>`
  (`engine/bundle.ts`) and keeps tools in `<data>/hermes-runtime`; its log is
  `<data>/engine.log`. First launch: the setup assistant prepares Hermes in the
  background (`POST /api/hermes/prepare`), minutes, with progress.
- The engine must stay bundleable as CommonJS: no top-level `await`, and guard
  every `import.meta` (it is empty in the bundle).
- Unsigned on purpose (free and open source): macOS ad-hoc (`signingIdentity: "-"`),
  Windows unsigned. `.github/workflows/release.yml` builds draft releases from
  `v*` tags for macOS (arm64, x64), Windows and Linux; the website explains the
  one-time "Open Anyway" / "Run anyway".

## Shared board

- One Y.Doc per board, everything keyed by id (no Y.Array), node fields as
  separate map entries. Persisted as plain JSON by the relay; loaded loosely
  (a half-edited board is not compile-valid and must still load).
- Clients use `disableBc: true`: every edit must reach the relay, because compile
  reads the board from the relay, never from a client payload.
- Board files: export writes the relay's copy as `mcbot.graph/v1` JSON to
  `<workspace>/exports/`, never overwriting (the browser demo downloads it);
  import always makes a new board and loads it loosely. Boards hold key names
  only, so a board file holds no secrets.
- The engine listens on loopback only and checks `Origin` and `Host` on every
  request and WebSocket upgrade. No auth in v0.

## UI invariants

- **Look:** dark, quiet, Apple-native. All colours, radii, shadows and motion are
  tokens in `src/app/styles/tokens.css`; components use tokens, not literals.
  Colour means identity (agents, node kinds) or state (running, ok, failed).
  macOS system colours, flat: the accent is system blue; no gradients, glows or
  gradient text (the website follows the same rule).
- **Less text.** No explanatory paragraphs in the UI. Labels are short; detail
  lives in tooltips (`data-tip`). Empty states are one line plus one action.
- **Everything structural is a graph.** The harness is the editable React Flow
  canvas; runs, memory and folders use the read-only `views/GraphCanvas.tsx`.
  Give each GraphCanvas a `key` per subject (root, run, agent) so React Flow
  state never leaks between subjects.
- **Faces:** agents are glass food bots (`src/app/faces/foods.ts`): the name picks
  the food and its `--food-*` colour, so the same name is always the same bot.
  An agent's expression is its run state: thinking, happy, sad. People are
  Blobatars with `tone={0.48}` (auto tone can be near-black on dark).
- **Logo:** the gray glass burger (`logoSvg`). The website's bots and the logo
  files (`site/assets/logo.svg`, `design/icon.svg`) are generated from the same
  code by `npm run site:foods`; `npm test` fails when they are stale. App icons:
  render `design/icon.svg` to `design/icon-1024.png`, then `npx tauri icon`.
- **Effects use block bodies.** `useEffect(() => { … })` — never a concise arrow:
  `scrollIntoView` returns a Promise in current Chromium, and an effect that
  returns a non-function crashes React on cleanup.
- Views live behind an error boundary; a broken view must not blank the window.
- **Links out of the app** go through `openExternal` (`src/app/lib/open.ts`): the
  Tauri opener plugin, https only. A plain `target="_blank"` link does nothing
  inside the app window.
- **Report a problem** (⌘K): `GET /api/diagnostics` (`engine/diagnostics.ts`),
  with saved key values, token-shaped strings and the home folder hidden.
  Nothing is sent; the person copies it into an issue.
- **No code under noncommercial, source-available or copyleft licences** (hard
  rule 1). Other products are feature references only, and McBot never copies
  another product's look or trade dress. Blobatar (MIT) is fine.
- **Local folders:** the engine reads only inside roots the user opened
  (`<workspace>/folders.json`), the shared files folder and compiled profiles —
  read-only, path-checked.

## Stack (do not substitute)

Tauri **2.x** (never 3, it is alpha) · React + TypeScript · React Flow
(`@xyflow/react`) · Yjs + y-websocket protocol · zod · zustand. No database, no
auth, no cloud: local JSON + the filesystem.

## Out of scope until asked

Auth, SSO, Langfuse, OpenTelemetry, a cloud tier, a marketplace, git
integration beyond showing status and diffs, ACP (pending the owner's decision
for M9), A2A. The terminal, code editor and browser panes are planned (M8).
Everything else on the way is ordered in `docs/PLAN.md` (M5–M15, reasons in
`docs/NEXT.md`); build in that order. Postgres and Redis belong to the
optional team server only, never the desktop app.

## Commands

```
npm run dev        engine (:4317) + Vite (:5173)
npm run desktop    the Tauri app (runs `npm run dev` itself)
npm test           all tests (MCBOT_E2E=1 or MCBOT_HERMES_BIN adds a real Hermes run); CI runs them on every PR
npm run typecheck
npm run stub-llm   deterministic OpenAI-compatible server on :11500 for offline runs
npm run build:demo browser-only demo in dist-demo/ (in-page engine, simulated runs)
npm run engine:setup   prepare McBot's own Hermes (once, and after a Hermes update)
npm run cli -- …    McBot's Hermes in a terminal, on McBot's agents (HERMES_HOME=~/McBot/hermes)
npm run site:foods the website's food bots and the logo files, from src/app/faces/
npm run engine:sync -- <hermes-agent checkout> [ref]   merge an upstream Hermes release into hermes/
npx tauri build    the installer for this computer (engine + Hermes inside; unsigned)
MCBOT_E2E=1 npm test   also run the real end-to-end test on McBot's own Hermes
```

## Browser demo and website

- `src/app/demo/` serves the engine's API inside the page for `npm run build:demo`.
  Compile there is the real compiler; runs are simulated, and the UI says so
  (the Demo chip). When an engine route changes, change the demo to match. The
  desktop build must tree-shake it out (`DEMO` is a build-time constant).
- `site/` is the website: static, no build step. `.github/workflows/site.yml`
  publishes it to GitHub Pages with the demo at `/demo/`. Download buttons read
  the latest GitHub release and show "Coming soon" until one exists.
- The hero is the glass burger photo (`site/assets/burger.webp`, cut from a black
  background so the glass stays see-through); `site/site.js` moves its pupils
  (in the eye holes) toward the cursor, nothing more. The crew graph and the
  parade use `site/foods.js`. Clean and flat like a Mac page: system font, black
  and gray surfaces, white buttons; no gradient text, glows or scroll effects.
  Product shots (`site/assets/*.webp`) are taken from the demo at 1440×900 @2x
  without the Demo chip; re-shoot them when the UI they show changes.

Shortcuts: ⌘K commands · ⌘1–7 views · ⌘S compile · ⌘N new window (desktop).
