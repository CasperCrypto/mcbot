# McBot — invariants

McBot is a desktop app (Tauri 2, macOS + Windows) where a team draws a harness
of AI agents as a graph, and the graph **compiles into a real, runnable Hermes
Agent setup on disk**. The same graph then shows what each agent is doing, what
it remembers, and what it costs.

**The compile step is the product.** If the graph does not write real files
that a real runtime reads, this is a drawing tool. Hermes Agent is the engine
and ships inside McBot: one download, nothing else to install. What merges into
McBot and what is rebuilt is decided in `docs/MERGE.md`.

**Hermes is the harness; the board is its live picture and editor** (decision 9 in
docs/PLAN.md). `src/harness/read.ts` turns a Hermes setup back into a board (the inverse of
compile, round-trip tested on the golden fixtures; what it cannot show yet is listed, never
dropped). The writer merges config.yaml (`src/harness/merge.ts`, `OWNED`): McBot changes only
the keys the board shows and keeps every other key, comment and its place. Changes made in
Hermes reach the open board live (`engine/hermesSync.ts`, `src/harness/reconcile.ts`): the Code
view saves an agent's SOUL.md, config.yaml, profile.yaml and skills (`agentEditable`), and a
watcher follows edits by the CLI or agents. Three-way against `<workspace>/hermes-seen.json`, so
a board edit not compiled yet stays and McBot's own compile never echoes back.

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
   OpenAI-compatible endpoint. No per-vendor SDKs, ever. A ChatGPT or Claude plan the
   person already pays for runs only through runtimes Hermes or the vendor ship (Hermes'
   Codex runtime, the vendor's own CLI as an agent over ACP), never an SDK inside McBot
   (owner's decision, docs/PLAN.md).
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
  nothing else, and refuses to write into a profile dir it did not create. Inside
  config.yaml it owns only the keys in `OWNED` (`src/harness/merge.ts`); when compile
  writes a new key, add it there too (a test fails otherwise).
  Hermes writes `state.db`, `sessions/`, `memories/`, logs and seeded skills into
  the same dirs.

## Runtime invariants

- McBot's own Hermes runs agents through the gateway's **runs API** (`engine/hermesRuns.ts`:
  `POST /p/<agent>/v1/runs`, SSE events), so a risky command stops and asks the person
  (approval cards: `run.approval`, answered with `POST /api/runs/:id/approval`). The key and
  port live in `<workspace>/gateway.json` and go into the root's and each profile's `.env`.
  Those runs read `platform_toolsets.api_server`, so abilities compile to `cli` and `api_server`.
- An external Hermes runs as `HERMES_HOME=<root> hermes -p <agent> chat --query-file - --oneshot --format stream-json`,
  cwd `<profile>/workspace`, prompt on stdin, no `--source` (upstream rejects unknown
  sources); it never asks (one-shot runs deny instead).
- `hermes chat` auto-starts one gateway per root; it discovers MCP servers only
  at boot. After a compile changes a config.yaml, the engine stops it and
  **waits for the process to exit** before the next run — only for McBot's own
  root (`managedRoot`), never an external `~/.hermes`.
- MCP tools are `mcp__<server>__<tool>`; calls may arrive wrapped in `tool_call`.
- An agent's abilities compile to `platform_toolsets.cli` and `.api_server` (unset = Hermes' default:
  everything but video, X search and the task board; the Inspector can turn all on); a wired image/video maker compiles to
  `image_gen` / `video_gen` and turns its tool set on. Makers are Hermes' own
  provider plugins: McBot only names one and its key variable, so hard rule 4 (two
  chat-model providers, no vendor SDKs in McBot) still holds.
- A chat app node is one bot for one agent, on any platform Hermes ships: the list is generated
  from `hermes/plugins/platforms/*/plugin.yaml` (`npm run engine:platforms` →
  `src/contracts/platforms.generated.ts`; `npm test` fails while it is stale). Its secrets are saved
  in McBot under `channelKeyName` (Telegram boards keep their `tokenEnv`), its plain settings sit on
  the board (`settings`), and both, with who may message it, go into that agent's `.env` under the
  plugin's own variables (settings only once its first secret is saved). Only Telegram's own Bot
  API server is compiled (`platforms.telegram.extra.base_url`). The engine refreshes agents'
  `.env` after a compile, a saved key, a board save and at start, and runs
  `hermes gateway ensure` while any compiled agent has a bot with everything filled in.
  No allowed users = nobody can message it (Hermes refuses unknown senders).
- Run is refused (409) if the agent's files on disk differ from the board — compile first.
- One run at a time per agent from the UI: a message sent while the agent works (or while its run
  is starting, `starting` in the store, set by `runAgent`) joins that agent's queue and is sent
  when it is free (`queue`, dispatched in App.tsx). A message that cannot start goes back first
  and the queue waits for the person. `scripts/mcbot.ts` (`npm run mcbot`) drives the same
  loopback API from a terminal; runs it starts show live in every window.
- The tool catalog (`src/app/graph/catalog.ts`) also has hosted MCP servers that need no key
  (Exa, Parallel: `transport: http`, `url` only), so agents can search the web from minute one,
  and Hermes' own vetted connectors (`hermes/optional-mcps`, generated: `npm run engine:connectors`
  → `src/contracts/connectors.generated.ts`; `npm test` fails while it is stale). An OAuth one
  compiles to `auth: oauth` (+ its pinned `oauth` block) and signs in with `hermes -p <agent> mcp
  login <name>` (`POST /api/connectors/login`, host only).
- Hermes' skills: its 44 bundled skills are on for every agent (`builtinSkills`; `false` compiles
  `.no-bundled-skills`). Its gateway seeds only its own home, so after a compile the engine runs
  `hermes -p <agent> skills opt-in --sync` once per profile without `skills/.bundled_manifest`
  (`engine/skills.ts`). The official library (`hermes/optional-skills`) installs per agent with
  `hermes -p <agent> skills install official/<path> --yes` (host only). Both live in category
  folders, which the board reader skips: they are Hermes', not blocks.
- Memory edits: Hermes' `§` format byte for byte, refused while the profile is
  running, and only against the sha256 the editor read.
- An agent's `dailyBudgetUsd` is McBot-side only (never compiled, no Hermes key): `buildCostReport` compares
  today's (UTC) spend with it; Cost shows the bar and Home's "Needs you" warns at 80% and 100%. It does not stop runs yet.
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
  first. No bash needed, so Windows works the same way. Its runs go through
  the runs API (sessions labelled `api_server`; its CLI commands keep `--source mcbot`);
  an external Hermes gets one-shot `hermes chat` and no `--source`. A one-shot run that
  meets "Gateway starting/draining" is retried once (a new home's gateway boots slowly).
  Runs never set `HERMES_MANAGED` (a managed install stops creating its home's
  folders); `npm run cli` does, so `hermes update` says updates come with McBot.
  Changes inside `hermes/` are listed in `hermes/MCBOT.md`; upstream releases come
  in with `npm run engine:sync`, which also lists upstream files Hermes'
  `.gitignore` hides (add them with `git add -f`).
- First launch runs the setup assistant (`src/app/setup/`): its answers go into
  every agent's SOUL.md and their USER.md memory; `<workspace>/setup.json`
  records that it ran. Local model servers are found by asking the usual
  addresses for `/v1/models` (Ollama :11434, LM Studio :1234, llama.cpp :8080, vLLM :8000,
  Jan :1337), or any address the person types.

## The installed app

- One download: the Tauri shell, `mcbot-engine` (the engine as a Node single
  executable, `scripts/build-engine.mjs`, Tauri `externalBin`) and Hermes as a
  resource (`scripts/stage-hermes.mjs`: only git-tracked files of `hermes/`).
  `tauri build` runs all three (`beforeBuildCommand`).
- The window opens a few seconds before the engine answers: it says "Starting McBot…" and only
  after 20 s says the engine didn't start (the `npm run dev` hint only outside the app).
- In release builds the shell starts the engine with `MCBOT_HERMES_BUNDLE` and
  `MCBOT_DATA_DIR` and kills it on quit; `tauri dev` runs `npm run dev` instead.
  The engine copies the read-only Hermes to `<data>/hermes-<stamp>`
  (`engine/bundle.ts`) and keeps tools in `<data>/hermes-runtime`; its log is
  `<data>/engine.log`. First launch: the setup assistant prepares Hermes in the
  background (`POST /api/hermes/prepare`), minutes, with progress.
- The shell adds a menu bar (tray) icon whose count is Home's "Needs you" (`set_attention`,
  sent by the window) and system notifications when an agent finishes, fails, asks for a
  review or is blocked while no McBot window is in front (`src/app/state/signals.ts`).
- The engine must stay bundleable as CommonJS: no top-level `await`, and guard
  every `import.meta` (it is empty in the bundle).
- Unsigned on purpose (free and open source): macOS ad-hoc (`signingIdentity: "-"`),
  Windows unsigned. `.github/workflows/release.yml` builds draft releases from
  `v*` tags for macOS (arm64, x64), Windows and Linux; the website explains the
  one-time "Open Anyway" / "Run anyway". On a Mac with no Developer ID, the free way
  without a prompt is `site/install.sh` (`curl … | sh`): curl sets no quarantine flag,
  so Gatekeeper never asks; it installs the newest release's DMG into /Applications
  (an AppImage into ~/.local/bin on Linux) and talks only to github.com.

## Shared board

- One Y.Doc per board, everything keyed by id (no Y.Array), node fields as
  separate map entries. Persisted as plain JSON by the relay; loaded loosely
  (a half-edited board is not compile-valid and must still load).
- Sticky notes live in the board too (`notes`, optional in `mcbot.graph/v1`, keyed by id like
  everything else): on the canvas for everyone, pinned ones on Home. The compiler never reads them.
  Their paper colours (`--note-*`) are content, not UI chrome.
- Team chat lives in the board too (`messages`, optional in `mcbot.graph/v1`, keyed by id, last
  500 kept): the faces in the title bar open the Team panel (`src/app/shell/TeamPanel.tsx`): who is
  here and in which view, who joined and is away, and the chat. "@agent …" runs that agent and posts
  its answer (posted by the asker's window when the run ends). The compiler never reads messages.
  The demo shows two simulated teammates on its own board.
- Clients use `disableBc: true`: every edit must reach the relay, because compile
  reads the board from the relay, never from a client payload.
- Board files: export writes the relay's copy as `mcbot.graph/v1` JSON to
  `<workspace>/exports/`, never overwriting (the browser demo downloads it);
  import always makes a new board and loads it loosely. Boards hold key names
  only, so a board file holds no secrets.
- The engine listens on loopback and checks `Origin` and `Host` on every
  request and WebSocket upgrade. **Share on your network** (`engine/sharing.ts`, off by
  default) also opens port 4318 to the LAN while it is on: every request there needs an
  allowed `Origin` and a member key (`Authorization: Bearer`, or `?key=` for WebSocket/SSE),
  got with the invite link (`http://<address>:4318/join?code=…`: 24 h, for everyone it is sent
  to, until "New link" replaces it or sharing stops; failed joins rate-limited); only key hashes
  are stored (`<workspace>/sharing.json`, owner-only). `GET /join` on that port is the one
  request without an Origin: a static page that says how to join from McBot (no data). The
  Share sheet copies the link or emails it: McBot has no mail server, so it opens a ready-to-send
  message to the typed address in Gmail or Outlook on the web, or the mail app (`lib/invite.ts`);
  Join takes the pasted link. Members reach boards, compile, runs,
  tasks, schedules, memory and cost (`guestAllowed`), never keys, files, setup, sharing or
  the engine's controls. Agents always run on the host. A joined window keeps the host's
  address and its key in localStorage (`src/app/lib/remote.ts`) and hides Code and Files.

## UI invariants

- **Look:** dark, quiet, Apple-native. All colours, radii, shadows and motion are
  tokens in `src/app/styles/tokens.css`; components use tokens, not literals.
  Colour means identity (agents, node kinds) or state (running, ok, failed).
  macOS system colours, flat: the accent is system blue; no gradients, glows or
  gradient text (the website follows the same rule).
- **Glass and springs** (`src/app/styles/glass.css`, loaded last): whatever floats over content
  (sheets, menus, tooltips, the dock, board blocks, the inspector, the chat header and composer)
  is a material — `--mat-*` fill, `--mat-blur`, a hairline edge and specular top line
  (`--mat-edge`) — never a gradient; content surfaces stay solid. Motion uses `--spring-snappy`
  (controls), `--spring-bouncy` (things that arrive) and `--spring-smooth` (things that move):
  real springs via CSS `linear()` where supported, cubic fallbacks in tokens.css. The rail's
  selection and segmented controls' thumbs slide. Reduced motion turns it all off.
- **Less text.** No explanatory paragraphs in the UI. Labels are short; detail
  lives in tooltips (`data-tip`). Empty states are one line plus one action.
- **Settings** (`views/SettingsView.tsx`, ⌘, and the gear in the rail): models (local servers
  found or at any address, cloud presets in `lib/providers.ts`, all OpenAI-compatible; adding one
  places a model block and wires it to the agents picked, main or backup), API keys (names only,
  replace or remove), your name, team, engine, run setup again. Home's "Get started" and "Needs
  you" point there when an agent has no model, a key is missing or a local server isn't answering.
- **Board | Hermes** (top of the board): Board is what you edit; Hermes (`src/app/graph/HermesView.tsx`)
  draws the whole harness behind it: gateway, chat apps, each agent's model chain, abilities,
  tools, makers, skills, memory, schedules, the shared task board, approvals. A click on a part
  opens what makes it (`hermesTarget.ts`): the block on the Board, or the Memory, Home, Tasks or
  engine view, so what you change is always what compiles.
- **Compile** says how it went in a notice (with "Fix" on the first block with a problem); the
  compile sheet (files and diffs) opens only when asked (the notice's "Files", ⌘K → Compiled files).
- **Rich answers** (`src/app/chat/rich.ts`, `RichText.tsx`): an agent's answer is drawn from
  Markdown (headings, lists, tables, code with Copy, links through `openExternal`, images it made)
  plus ` ```chart ` (JSON → SVG bar, line or pie) and ` ```choices ` (reply buttons on the latest
  answer). Parsed to blocks and rendered as React elements, never HTML. New agents' souls carry
  three lines that teach the format (`withRichAnswers`: presets, starter teams, New agent).
- Connections are agent-centred (Hermes' model): a model, tool, maker or chat app connects only to
  an agent. While a connection is drawn the rest dims; a refused drop says why. Chains between
  them are workflows (M10).
- **Type:** San Francisco on a Mac (`-apple-system`; SF may not be shipped elsewhere, so Windows
  and Linux fall back to Segoe UI or Inter). `src/app/styles/premium.css` (loaded last) holds the
  type scale, hairlines, layered shadows and spring motion; reduced motion turns it off.
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
- **Dynamic island** (`src/app/shell/Island.tsx`): always in the middle of the title bar. At rest a
  slim pill; it grows (spring, `--ease-island`) into the most important thing now: an approval
  (answer inline), agents at work, a compile, a new team message, a notice. It opens into
  everything at once plus quick actions as the pointer heads for it — its path is projected
  ~140 ms ahead, a fast sweep across the title bar does not count — leans in when the pointer is
  close, and closes once the pointer moves away; click or Enter pins it open until Esc or a click
  outside. One height (30px) for every title-bar control.
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
  (`<workspace>/folders.json`), the shared files folder and compiled profiles,
  path-checked. The folder picker (`shell/FolderPicker.tsx`, `GET /api/fs/browse`, host only)
  lists folder names, never files, so a folder is opened by clicking, not by typing its path. The Code view's editor (Monaco, loaded on first use) writes back
  only to opened folders, the shared files folder, an agent's `workspace/` and its Hermes
  settings (SOUL.md, config.yaml, profile.yaml, skills; the board follows them), never memory,
  logs, state or a key file, and only over the sha256 it read.
- **Terminal:** real shells in the desktop shell (`src-tauri/src/terminal.rs`,
  portable-pty), never in the engine, so the engine stays one plain executable.
  The browser has none.
- **Browser view:** on macOS and Windows the page is a real child webview over the view's page
  area (`src-tauri/src/browser.rs`, Tauri `unstable` feature, one `page-<window>` per window), so
  sites that refuse iframes still load; it hides while a sheet or ⌘K is open (native views draw
  above HTML), and is placed again after layout and motion settle (the view has no entry motion).
  "Open in your browser" hands a page to the system browser (opener plugin: https, and http on
  localhost); `browser_open` (McBot's own window) is async, since a window built in a synchronous
  command deadlocks on Windows.
  Remote pages get no IPC. Linux (GTK ignores child bounds) and the demo use an iframe: the engine
  first asks whether the site allows framing (`GET /api/web/frameable`), and one that refuses
  gets "Open in a window" instead of a blank page.

## Stack (do not substitute)

Tauri **2.x** (never 3, it is alpha) · React + TypeScript · React Flow
(`@xyflow/react`) · Yjs + y-websocket protocol · zod · zustand. No database, no
auth, no cloud: local JSON + the filesystem.

## Out of scope until asked

Auth, SSO, Langfuse, OpenTelemetry, a cloud tier, a marketplace, git
integration beyond showing status and diffs, A2A. (ACP is in: M9, owner's decision.) The terminal, code editor and browser panes are planned (M8).
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
npm run mcbot -- agents | run <agent> "<prompt>" [--wait] [--json] [--board <id>]   script the running McBot
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

Shortcuts: ⌘K commands · ⌘1–9 views · ⌘S compile · ⌘N new window (desktop).
