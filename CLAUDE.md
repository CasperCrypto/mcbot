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

**Name:** people see **McBot Studio** (app, installers, window, About, website at
https://mcbot.studio, README, setup, invites). Internal names stay `mcbot` and must not change:
`mcbot.graph/v1`, `mcbot.compile/v1`, `.mcbot/`, `MCBOT_*`, `mcbot-<name>` providers,
`--source mcbot`, `~/McBot`, the npm package, the repo, and the app identifier
`dev.mcbot.desktop` (it names the data folder holding the 1.3 GB engine tools; changing it
re-downloads them for everyone). The Windows MSI upgrade code is pinned in tauri.conf.json because
Tauri derives it from the product name.

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
- **Agents know where they work.** Every SOUL.md gets a "Where you work" section after the agent's own text and
  the team knowledge, before Team (`renderWhere` in `src/compile/soul.ts`): McBot Studio and Hermes, its models by
  id and where they run ("on this computer", "through OpenRouter", named from the base URL's host), its tools by
  the id it calls them with and its makers. Only facts config.yaml holds, so a board read back from Hermes compiles
  the same SOUL.md; `splitSoul` drops the section. Every agent that can load skills also gets McBot's guide as a
  Hermes skill, `skills/mcbot/mcbot-studio/SKILL.md` (`src/compile/mcbotGuide.ts`): Hermes lists it with a
  description of at most 60 characters and the agent reads it with `skill_view` only when asked about McBot. Its
  category folder keeps the board reader off it; the Skills view shows it built in. **Keep the guide true to the
  app:** when a view, shortcut or flow changes, change the guide (golden-tested like every compiled file).
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
  A run Hermes refuses because its gateway is restarting (`gateway_draining`, `runtime_draining`:
  `GATEWAY_BUSY` in `engine/runner.ts`) waits and is sent again, up to a minute, only if it was refused
  before it said or did anything. People read a failure's reason in words (`lib/runError.ts`).
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
- **Chat knows the agent's tasks.** A task runs in a session of its own (Hermes' kanban), so every chat run McBot
  starts carries what is true right now as the runs API's `instructions` (`src/harness/liveContext.ts`, pure: its open
  tasks with how long and how far its run got, what it finished today, work it gave others; nothing when it has none;
  never in a guest's run). Hermes adds it for that call only and never stores it. The task panel shows the work so far
  from the assignee's `state.db` (`readTaskWork`: the session opened by "work kanban task <id>", its steps and last
  words, tokens and the home folder hidden; this computer's windows only) and "Looks stuck" after 10 quiet minutes.
- **Until done** (the New task form's switch, on by default; Home's task mode too): `hermes kanban create --goal`,
  Hermes' goal loop: a judge on the agent's own model checks each round against the task, up to 20 rounds, then
  blocks it for review (`lib/taskNote.ts` says why in plain words). A person's "Mark done" / "Approve" is always
  `kanban complete --force`, which McBot's Hermes patch makes a person's override (no goal judge, as Hermes'
  dashboard; a worker is still judged), and a "Mark done" without words sends what came of the task (Hermes refuses
  an empty completion). `hermesEnv` never passes on a kanban worker's scope (`HERMES_KANBAN_*`, `HERMES_PROFILE`…).
- Run is refused (409) if the agent's files on disk differ from the board — compile first.
- **Stop** (`Runner.cancel`, every Stop button through `stopRun` in `actions.ts`) always ends a run
  within `STOP_GRACE_MS` (4 s): it asks Hermes (`/v1/runs/<id>/stop`, which only acts between steps)
  or sends SIGINT, then ends the run itself (`interrupted`, one `run.finished` per run) and escalates
  to SIGTERM/SIGKILL. A run still starting never reaches Hermes. A run left "running" by an engine
  that quit is ended at start and by Stop. Stop also clears that agent's queued messages.
- One run at a time per agent from the UI: a message sent while the agent works (or while its run
  is starting, `starting` in the store, set by `runAgent`) joins that agent's queue and is sent
  when it is free (`queue`, dispatched in App.tsx). A message that cannot start goes back first
  and the queue waits for the person. `scripts/mcbot.ts` (`npm run mcbot`) drives the same
  loopback API from a terminal; runs it starts show live in every window.
- The tool catalog (`src/app/graph/catalog.ts`) opens on **Images & video** (Hugging Face's and Comfy Cloud's
  connectors, `MEDIA_CONNECTORS`). It also has hosted MCP servers that need no key
  (Exa, Parallel: `transport: http`, `url` only), so agents can search the web from minute one,
  GitHub on GitHub's own hosted server (a hosted entry with a key sends it as
  `Authorization: Bearer ${env:NAME}`; Hermes renders `${env:…}` in `url` and `headers`),
  and Hermes' own vetted connectors (`hermes/optional-mcps`, generated: `npm run engine:connectors`
  → `src/contracts/connectors.generated.ts`; `npm test` fails while it is stale). An OAuth one
  compiles to `auth: oauth` (+ its pinned `oauth` block) and signs in with `hermes -p <agent> mcp
  login <name>` (`POST /api/connectors/login`, host only).
- Hermes' skills: its 44 bundled skills are on for every agent (`builtinSkills`; `false` compiles
  `.no-bundled-skills`). Its gateway seeds only its own home, so after a compile the engine runs
  `hermes -p <agent> skills opt-in --sync` once per profile without `skills/.bundled_manifest`
  (`engine/skills.ts`). The official library (`hermes/optional-skills`) installs per agent with
  `hermes -p <agent> skills install official/<path> --yes` (host only). Both live in category
  folders, which the board reader skips: they are Hermes', not blocks. The Skills view
  (`views/SkillsView.tsx`, host only) shows all three per agent plus what each agent taught itself
  (`profileSkills`) and "Suggested for <agent>" (`lib/suggestSkills.ts`, pure: what the agent is for
  against each library skill, a starter card's own picks first); names read through `lib/names.ts`
  (Antigravity CLI, MLOps, MCP servers); the Inspector links to it. Its one box searches every registry Hermes knows
  (`hermes skills search --json`) or, given a GitHub link or SKILL.md URL, installs it into the
  `added` category after Hermes' scan (`skillSources`: a GitHub folder tries `owner/repo/path`, then
  the raw SKILL.md). Its Plugins pane (`views/PluginsPanel.tsx`, `engine/plugins.ts`) lists the
  agent's plugins with on/off and the curated catalog (`hermes/plugin-catalog`); every change goes
  through `hermes -p <agent> plugins …`, which writes `plugins.enabled` itself (never compiled).
- **Questions:** an agent can ask the person (Hermes' `clarify`): the runs API's event stream carries approvals only,
  so while a clarify step is open the engine reads `pending_controls` from the run's status (`Runner.watchQuestions`,
  `run.question` / `run.question.settled`) and `POST /api/runs/:id/reply` answers (a choice, a JSON array for several,
  text, or "" to skip; a guest may answer in their own run). `approvals/QuestionCard.tsx` in Chat, Home's "Needs you"
  and the island; Hermes' typed-skip hint is dropped. Hermes' api_server default leaves out clarify, computer use and
  speech, so compile always pins `platform_toolsets.api_server` to the board's abilities (`cli` only when chosen).
- Computer use: the chat shows the agent's screen (`chat/screen.ts`: each `computer_use` capture's
  `screenshot_path`), live while it runs and as a step slider after; Stop takes it back.
- Memory edits: Hermes' `§` format byte for byte, refused while the profile is
  running, and only against the sha256 the editor read.
- An agent's `dailyBudgetUsd` is McBot-side only (never compiled, no Hermes key): `buildCostReport` compares
  today's (UTC) spend with it; Cost shows the bar and Home's "Needs you" warns at 80% and 100%; at 100% `POST /api/runs` refuses (409) the runs McBot starts (Hermes' own schedules and task-board runs are not stopped).
- **Learn** (`views/LearnView.tsx`, pure `src/harness/learn.ts`, `engine/learn.ts`; docs/TRAINING.md): the agents'
  work as data to train a model of your own. Thumbs up / down on any answer in Chat (`<workspace>/ratings.json`,
  `GET/POST /api/ratings`, teammates too) and an agent's **checks** (`checks` on the agent, McBot-side only, never
  compiled: mentions, never mentions, used a tool, word counts, valid JSON) give each run a reward from 0 to 1 (the
  rating wins; failed or stopped runs are 0). Export (`POST /api/learn/export`, host only) writes one agent's
  conversations (runs of one Hermes session together) to `<workspace>/datasets/`, never over an earlier file, as
  OpenAI chat JSONL, the same with rewards, or Hermes' own trajectory format; saved key values, token-shaped strings
  and the home folder are left out (`redact`). Training itself happens elsewhere (MLX, Unsloth, hosted fine-tuning);
  the model comes back as a model block.
- Cost comes from each profile's `state.db`; Hermes-priced vs McBot-estimated is
  always labelled. Hermes reports no GPU time — do not fabricate it. A session on a local model is
  **Free** (`local` on the session), never "unpriced": only cloud models are asked for a price.
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
  `.gitignore` hides (add them with `git add -f`). Every Monday
  `.github/workflows/hermes-sync.yml` does that for upstream's newest stable tag, runs every
  test and build, and opens a PR (a draft when the merge or a check needs a person). Engine
  updates reach people only through a McBot release, never on their own.
- **Update notice:** the installed app's engine (`checkUpdates`, off in tests and dev; `MCBOT_NO_UPDATE_CHECK=1`
  turns it off) asks `api.github.com/repos/CasperCrypto/mcbot/releases/latest` at most every 6 h
  (`engine/updates.ts`, `GET /api/update`, host only), sending nothing about the computer. A newer published
  release shows once per launch as a notice and in Settings → About, with Download (the release page). Installing
  stays manual until the signed Tauri updater (owner's key).
- First launch runs the setup assistant (`src/app/setup/`, pure parts in `setup/onboarding.ts`), step by
  step: who it is for, you, your business (what you do, offer, customers, links), what the agents should
  get done (goals → starter teams), voice and channels, the team (members can be left out), a model,
  and the tools that team needs: images and video through Hugging Face (its own connector,
  `hermes/optional-mcps/hugging_face`, signed in at the end; the default without a cloud key) or a
  maker service and its key (unless the cloud model's key already runs it); web search needs none. The answers become the board's **brief** (every agent's SOUL.md)
  and USER.md memory; the team is built with its tools, makers and shared files, compiled, and its
  Hermes skills installed; `<workspace>/setup.json` records that it ran. Local model servers are found by asking the usual
  addresses for `/v1/models` (Ollama :11434, LM Studio :1234, llama.cpp :8080, vLLM :8000,
  Jan :1337), or any address the person types.

## The installed app

- One download: the Tauri shell, `mcbot-engine` (the engine as a Node single
  executable, `scripts/build-engine.mjs`, Tauri `externalBin`) and Hermes as a
  resource (`scripts/stage-hermes.mjs`: only git-tracked files of `hermes/`).
  `tauri build` runs all three (`beforeBuildCommand`).
- The window opens a few seconds before the engine answers: it says "Starting McBot…". In the app it
  asks the shell how its engine is doing (`engine_status` in `src-tauri/src/lib.rs`: running, how it
  ended, why it couldn't be launched, the last 40 lines of engine.log with the home folder as ~) and
  `lib/engineHealth.ts` names it at once: stopped (exit code), blocked (antivirus or a missing file),
  McBot's port taken, or still starting after 20 s; the screen shows the log's end, Copy details and
  Restart engine (`engine_restart`). Outside the app it keeps the `npm run dev` hint after 20 s.
- In release builds the shell starts the engine with `MCBOT_HERMES_BUNDLE` and
  `MCBOT_DATA_DIR` and kills it on quit; `tauri dev` runs `npm run dev` instead.
  The engine copies the read-only Hermes to `<data>/hermes-<stamp>`
  (`engine/bundle.ts`; when an unfinished copy there is locked, as Windows does while a process holds
  a file in it, it uses `hermes-<stamp>-2` … instead of failing the start) and keeps tools in `<data>/hermes-runtime`; its log is
  `<data>/engine.log`. First launch: the setup assistant prepares Hermes in the
  background (`POST /api/hermes/prepare`), minutes, with progress.
- **Launcher:** ⌘⇧Space / Ctrl+Shift+Space from anywhere (`SUMMON`, tauri-plugin-global-shortcut)
  brings the front window forward with ⌘K open; ⌘K can "Ask <agent>…" directly. If another app
  holds the combination, McBot only logs it.
- The shell adds a menu bar (tray) icon whose count is Home's "Needs you" (`set_attention`,
  sent by the window) and system notifications when an agent finishes, fails, asks for a
  review or is blocked while no McBot window is in front (`src/app/state/signals.ts`).
- The engine must stay bundleable as CommonJS: no top-level `await`, and guard
  every `import.meta` (it is empty in the bundle).
- Unsigned on purpose (free and open source): macOS ad-hoc (`signingIdentity: "-"`),
  Windows unsigned. `.github/workflows/release.yml` builds draft releases from
  `v*` tags (or by hand) for macOS (arm64, x64), Windows and Linux; `publish-release.yml` (by hand, a tag)
  checks every installer is there, adds `docs/releases/<tag>.md` and publishes the draft; the website explains the
  one-time "Open Anyway" / "Run anyway". On a Mac with no Developer ID, the free way
  without a prompt is `site/install.sh` (`curl … | sh`): curl sets no quarantine flag,
  so Gatekeeper never asks; it installs the newest release's DMG into /Applications
  (an AppImage into ~/.local/bin on Linux) and talks only to github.com.

## Shared board

- One Y.Doc per board, everything keyed by id (no Y.Array), node fields as
  separate map entries. Persisted as plain JSON by the relay; loaded loosely
  (a half-edited board is not compile-valid and must still load).
- **Team knowledge** lives in the board too (`brief`, optional in `mcbot.graph/v1`; a Y.Map `brief` with one entry per
  field, so two people editing two fields keep both): who the agents work for, what you do, offer, customers, goals,
  voice, channels, how you sell, links, notes. Compile writes it into **every agent's SOUL.md** as a "Shared knowledge"
  section, after the agent's own text and before "Where you work" and Team (`renderKnowledge` in `src/compile/soul.ts`: SOUL.md
  is the one file Hermes always puts in the system prompt, `agent/prompt_builder.py` `build_context_files_prompt`);
  `splitSoul` in `src/harness/read.ts` reads it back out (the agent's soul never takes it in). Edited in the Team
  knowledge sheet (`shell/KnowledgeSheet.tsx`: ⌘K, Home's Get started, Layers → Context) and by the setup assistant.
- Sticky notes live in the board too (`notes`, optional in `mcbot.graph/v1`, keyed by id like
  everything else): on the canvas for everyone, pinned ones on Home. The compiler never reads them.
  On the canvas a note moves by its grip (top) or footer, its text never drags; a new one goes to free
  space (`noteSpot`), since notes sit behind blocks.
  Their paper colours (`--note-*`) are content, not UI chrome.
- Frames live in the board too (`frames`, optional in `mcbot.graph/v1`, keyed by id): a titled,
  tinted area (`graph/FrameNode.tsx`, class `board-frame`; `.frame` is the app's view container)
  behind the blocks. Dragging one by its title moves the blocks and notes whose centre is inside
  it; its own × removes it (never Backspace), its blocks stay. Right-click → Frame, or "Put in a
  frame" around a selection. The compiler never reads them; undo covers them.
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
- The engine listens on loopback and checks `Origin` and `Host` on every request and WebSocket
  upgrade. **Share** (`engine/sharing.ts`, off by default) also opens port 4318 while it is on,
  to the LAN and, for **anyone with the link** (`reach: "internet"`, the sheet's default), through a
  free Cloudflare quick tunnel (`engine/tunnel.ts`: `cloudflared tunnel --url`, no account;
  cloudflared from `MCBOT_CLOUDFLARED`, the PATH, or downloaded once from its GitHub releases into
  the tools folder and checked against the SHA256 its release notes list; its own home, since quick
  tunnels refuse a `config.yaml`; a new `https://<words>.trycloudflare.com` each start, no SSE, 200
  requests in flight, no uptime guarantee) or the host's own address (`ownUrl`). A link per role,
  24 h, for everyone it is sent to, until "New link" replaces it or sharing stops: **Can edit**
  (teammates: boards, compile, runs, tasks, schedules, memory and cost, `guestAllowed`) or **Can
  chat** (guests, customers: only `GET /api/guest`, their own runs with the agents the link names,
  their media; never a board, approvals or anything else). Each join trades the code for a member
  key (`Authorization: Bearer`, or `?key=` for WebSockets); only key hashes are stored
  (`<workspace>/sharing.json`, owner-only); failed joins are limited per person (Cloudflare's
  `cf-connecting-ip` through the tunnel) and overall. Runs record who started them (`by`, `byName`
  on `run.started`); a guest's events and run list hold only theirs, without this computer's paths,
  and a guest's question compiles a stale agent quietly (they can't compile). The share port serves
  the built app (`engine/webApp.ts`, `MCBOT_WEB_DIR`, the installer's `web/` resource; static files
  only, a strict CSP, no Referer), so a link opens McBot in any browser, laptop or phone: the join
  page (`shell/WebJoin.tsx`), then the app (a teammate) or `shell/GuestChat.tsx` (a guest); same-origin
  GETs carry no Origin, so there the member key is what counts. Windows that joined get events over a
  WebSocket (`/api/events`, quick tunnels carry no SSE). The Share sheet: Teammates | Guests (pick
  agents; it warns when a guest could make one use files, the terminal, code, the browser, the
  computer or wired tools, `lib/guestRisk.ts`), email chips sent through Gmail, Outlook or the mail
  app (McBot has no mail server, `lib/invite.ts`), Copy link, a QR code for a phone
  (`shell/QrCode.tsx`, qrcode-generator, MIT), who has access with their role. Join (desktop) takes a
  pasted link, http or https. Agents always run on the host. A joined window keeps the host's address,
  its key and role in localStorage (`src/app/lib/remote.ts`) and hides Code and Files.

## UI invariants

- **Look:** quiet, pro, Apple-native, and **dark, always** (owner's decision: no light or system
  appearance). Settings → Appearance (and ⌘K) picks one of macOS's eight accent colours
  (`lib/appearance.ts`: `data-accent` on `<html>`, kept per computer, applied before the first
  paint; every window follows at once) and the **Size** (100–145%, **120% by default**: the owner
  found 100% too small; ⌘+ / ⌘−): the app window's own zoom (Tauri `setZoom`,
  `core:webview:allow-set-webview-zoom`; never a CSS zoom, which breaks React Flow), so the native
  browser page is placed in zoomed units (`uiZoom`). **Nothing that sits in the page has an outline**
  (owner's decision, v3: outlined boxes read as a generic dashboard): cards, groups, fields, buttons
  and chips are set apart by a step in fill (`--surface-1/2/3`) and a soft lift (`--lift`);
  hairlines only divide rows inside a group (`--divide`). Tight radii (controls 7–8, cards 10–12,
  sheets 14). State colours are muted (`--ok-rgb`, `--warn-rgb`, `--fail-rgb`), shown as a small dot or
  glyph, never a tinted block: chips are neutral with a dot, counts are the accent, progress is
  neutral. The main action is a light button (`.btn.primary`, the send button), not a saturated
  block; the accent marks selection, focus and switches. A kind's tile and a brand's logo are **solid colour, like app
  icons** (owner's decision: colour that helps you recognise things; the website's brand rows): a kind
  on its `--k-*` colour, a brand on its own colour with the ink that reads on it (`LogoTile` in
  `graph/Logo.tsx`), a near-black brand on the dark tile, all with `--icon-lift`. The board's dock is
  those colour tiles (48px), growing under the pointer and its neighbours a little, like macOS's; the
  rail stays monochrome glyphs. McBot's own mark (the burger, `Logo`)
  stands for what McBot itself does (Ask McBot); no sparkles or other stock "AI" icons. All
  colours, radii, shadows and motion are tokens in `src/app/styles/tokens.css` (macOS's eight
  accent colours as `--accent-rgb` / `--accent` / `--accent-text`); components use tokens, not
  literals: overlays are `rgb(var(--tint-rgb) / a)`, state colours as text use `--*-text`
  (`styles/tokens.test.ts` fails on a literal colour). Fixed-colour surfaces are the exceptions:
  the island, colour tiles, swatches, note paper. `src/app/styles/pro.css` (loaded last) is the
  finish of every shared element (buttons, fields, chips, cards, tiles, nodes, dock, composer,
  Home). Colour means identity (agents, node kinds) or state (running, ok, failed), flat: the accent is
  the person's (system blue by default); no gradients, glows or gradient text (the website follows
  the same rule).
- **Glass and springs** (`src/app/styles/glass.css`, before `pro.css`): whatever floats over content
  (sheets, menus, tooltips, the dock, board blocks, the inspector, the chat header and composer)
  is frosted glass — `--mat-*` fill, a strong `--mat-blur`, a specular top light and the faintest
  rim (`--mat-edge`) — never a gradient; content surfaces stay solid. The palette, menus and sheets
  (`--mat-regular`, `--mat-thick`) blur what lies behind past reading, so only its light comes through. Motion uses `--spring-snappy`
  (controls), `--spring-bouncy` (things that arrive) and `--spring-smooth` (things that move):
  real springs via CSS `linear()` where supported, cubic fallbacks in tokens.css. The rail's
  selection and segmented controls' thumbs slide. Reduced motion turns it all off.
- **Pop-up buttons, never a native `<select>`** (its list is a plain grey box on Windows and Linux):
  `Picker.tsx` is the button and the glass menu (`.menu`, classes `pick-*`; ↑ ↓, Enter, Esc, type-ahead;
  portalled, closes on scroll, one open at a time). Agents show their face (`lib/agentOptions.tsx`), and
  two agents with the same name also say what each is for.
- **Popups come and go like iOS** (`src/app/lib/presence.ts`): `usePresence` keeps a closed
  sheet, palette or panel mounted 200 ms with `data-closing` so it leaves the way it came
  (glass.css "Leaving"); `useDismiss` closes on a click anywhere outside and on Esc (the popup
  opened last first; Esc in a text field only leaves the field). Team chat, the compiled-files
  sheet, task and run details close on outside clicks; the inspector and live files on Esc
  (a board click already deselects); forms with typing in progress never close on a stray click.
  Only one panel sits on the right: team chat and the inspector replace each other. Panels you
  read in use `--mat-panel` (thicker glass), so board wires never cross their text. Panels driven
  by a value (the inspector's block, a task, a run step) use `useLingering`, which keeps showing
  the last value while they animate out. Loading shows flat breathing placeholders
  (`SkeletonCards`, `.skeleton`), never "Loading…".
- **Less text.** No explanatory paragraphs in the UI. Labels are short; detail
  lives in tooltips (`data-tip`). Empty states are one line plus one action.
- **Home** (`views/HomeView.tsx`) has one job: a greeting and the ask field, the team as a row of faces
  (a dot when one works, asks or is stuck), then only sections with something in them (Needs you, At
  work, Recent), and Up next beside the pinned notes. No counters that repeat a section, no spend card
  (today's cloud spend shows in the header when there is any), no empty notes.
- **No two agents show the same name:** `freeDisplayName` (`graph/defaults.ts`) makes a second Writer
  "Writer 2" for teams, Ask McBot's plans, New agent and Duplicate; the doctor renames twins a board has.
- **Star and follow:** `lib/links.ts` holds McBot's places (the repo, mcbot.studio, x.com/McBotstudio).
  Settings → About and ⌘K have Star on GitHub and Follow on X; McBot asks once for a star after five good
  answers, never in a joined window or the demo.
- **Settings** (`views/SettingsView.tsx`, ⌘, and the gear in the rail): models (local servers
  found or at any address, cloud presets in `lib/providers.ts`, all OpenAI-compatible; adding one
  places a model block and wires it to the agents picked, main or backup), API keys (names only,
  replace or remove), your name, team, engine, run setup again. Home's "Get started" and "Needs
  you" point there when an agent has no model, a key is missing or a local server isn't answering.
- **Ask McBot** (`shell/BuilderSheet.tsx`; ⌘K "Ask McBot to build…", the dock's first button, the empty board, New
  agent, and ⌘K's "Ask McBot to build this" for any typed request): the person describes the agents they need; a plan
  (`src/harness/plan.ts`: agents with soul, tools, chat apps, makers, Hermes skills and steps per message, plus
  hand-offs; a social media or marketing request gets a Designer that makes the images) is
  shown for review, and "Add to board" places it in one transaction (one ⌘Z takes it back), compiles, installs the
  skills (`learnTeamSkills`) and fits the board. The board's own model plans it when it can (`POST /api/builder/plan`,
  host only, `engine/builder.ts`: the first agent's model, else the first model block, on its OpenAI-compatible
  `/chat/completions`, the key read in the engine; hard rule 4), given only the app's catalog ids (`PLAN_CHOICES`);
  otherwise (no model, a teammate's window, the demo, a failed answer) `quickPlan` makes it from the words. Every plan
  is cut to known ids twice (`restrictPlan` in the engine and in `planToBoard`). Nothing changes until accepted.
- **Layers** (second mode of the board, `graph/LayersView.tsx`, pure `graph/layers.ts`): one agent's harness outside in,
  grouped like Settings: Surfaces (McBot chat, chat apps), Loop (steps per message, hand-offs, helpers, schedules),
  Context (SOUL.md, team knowledge, memory, skills, Hermes' compaction), Model (main and backups), Tools (abilities,
  connectors, makers), Plugins, Guardrails (approvals, never run, blocked websites, daily budget). Each row says whether the board sets it, Hermes
  defaults it or it is missing. The agent's own settings (steps per message, helpers, thinking, approvals, never run, blocked websites, daily budget: `edit`
  in `layers.ts`) change right in their row; every other row opens where it is changed. The loop's **steps per message** is the agent's `maxSteps`, compiled to `agent.max_turns`
  (only when set; `OWNED` `agent.max_turns`; read back by `src/harness/read.ts`). Its **thinking** is `reasoning`,
  compiled to `agent.reasoning_effort` (`none`…`ultra`, only when set; `OWNED`; read back). Its **approvals** is
  `approvals` (Always ask = `manual`, Smart = unset, Hermes' default, Never ask = `off`, quoted), compiled to
  `approvals.mode` (`OWNED`; read back, a bare `off` too; its other `approvals.*` keys stay in Hermes); Guardrails and the
  agent page change it, and the Share sheet warns when a guest could reach an agent that never asks. **Never run**
  (`neverRun`, globs) compiles to `approvals.deny`, which Hermes checks even when the agent never asks; **blocked
  websites** (`blockedSites`) to `security.website_blocklist` (`enabled: true`, `domains`); McBot owns those two only
  while the board sets a list or the existing one isn't switched off (`OWNED` `entries` sees both sides). The agent's own
  settings (steps, thinking, approvals, never run, blocked sites) also follow edits made in Hermes (`reconcile.ts`). A tool block's **only
  these tools** (`toolsInclude`, and `toolsExclude` read from Hermes) compiles to `mcp_servers.<name>.tools.include`
  / `.exclude`: fewer tool definitions, fewer tokens per message (Hermes' code-mode-like `execute_code` covers only
  its built-in tools, not MCP ones).
- **Board | Layers** (top left of the board, clear of the island): Board is the harness you draw; Layers is one
  agent's harness you change in place. (A read-only map of Hermes was here once; the owner asked what it was for
  if nothing could be changed in it, and it went.)
- **Undo** (`src/board/undo.ts`): Yjs' UndoManager over blocks, wires, notes and the board name
  (never chat), tracking only origin `null`, i.e. this window's own edits, so ⌘Z / ⇧⌘Z never take
  back a teammate's or the engine's change; edits within 600 ms are one step. Created with the doc
  (`state/board.tsx`); text fields and the code editor keep their own undo.
- **History** (`graph/HistoryPanel.tsx`, the board's "History" button, ⌘K "Harness history"; pure
  `src/harness/versions.ts`): every compile that changes the harness (blocks and wires, never positions, notes,
  frames or chat: `harnessHash`) keeps a version in `<workspace>/versions/<boardId>.json` (`GET /api/versions`,
  `POST /api/versions/name`; the newest 60 plus every named one), with what changed in words (`describeChanges`).
  Runs count against the version live when they started (`versionStats`), so two versions compare on runs,
  success, cost, time and tokens per run. Restore puts a version's blocks and wires back in one transaction (one ⌘Z).
  ⌘K "Copy the harness as text" (`src/harness/describe.ts`) gives any AI the whole graph in Markdown (key
  names only). The demo seeds two versions.
- **Live files** (`graph/LiveFiles.tsx`, the board's "Files" button, ⌘K): while you edit, the
  engine's dry-run compile (`GET /api/compile`, the real writer and config.yaml merge) is shown
  file by file, whole, with its changes against disk marked; selecting a block opens its agent's
  config.yaml. Nothing is written until Compile. The board fits beside it (⌘0 fits too).
- The canvas snaps to half the dot grid, Shift-drag selects a box, ⌘/Ctrl-click adds to a
  selection, and a minimap shows from 8 blocks on. Right-click (`graph/ContextMenu.tsx`, portalled
  to `body` because the view animates with a transform) adds a block where you clicked, or opens
  a block's actions: Open, Chat, Its files, Duplicate (⌘D, `duplicateNode`: new id, free name,
  no wires), Delete.
- **Harness doctor** (`graph/doctor.ts`, pure and tested; `shell/DoctorSheet.tsx`): the stethoscope
  in the title bar counts what is wrong (red: it won't run, yellow: runs badly or unseen) and its
  sheet lists every finding with one fix: compile errors, agents without a model, unsaved keys of
  models and tools in use (a hosted tool's is an error, a local one's a warning; saved key names are
  asked again whenever a key is saved or removed, `onKeysChanged` in `lib/engine.ts`), silent local servers, chat apps nobody may message, blocks wired to no agent
  (Remove, undoable), unpriced cloud models, paid agents with no daily budget, two agents with the same
  name (Rename), a lead that hands work to a team on a small local model (`sizeB` ≤ 14B: it tends to
  answer itself), files that differ from disk, an engine not ready. ⌘K "Check the harness".
- **Keyboard:** Tab / ⇧Tab walk the blocks (the focused block is selected), arrows nudge, F2 or
  Enter names it, ⌘D duplicates, ⌫ deletes, Esc deselects.
- **Compile** says how it went in a notice (with "Fix" on the first block with a problem); the
  compile sheet (files and diffs) opens only when asked (the notice's "Files", ⌘K → Compiled files).
- **The agent's plan** (`src/app/chat/plan.ts`): when an agent plans with Hermes' `todo_list` tool, its answer shows
  the newest list as a checklist (done, working on, next), live while it runs; the tool's steps are not listed again.
- **Rich answers** (`src/app/chat/rich.ts`, `RichText.tsx`): an agent's answer is drawn from
  Markdown (headings, lists, tables, code with Copy, links through `openExternal`, images it made)
  plus ` ```chart ` (JSON → SVG bar, line or pie) and ` ```choices ` (reply buttons on the latest
  answer). Parsed to blocks and rendered as React elements, never HTML. New agents' souls carry
  lines that teach the format (`withRichAnswers`: presets, starter teams, New agent).
- **Drawings** (`chat/drawing.ts` pure, `chat/DrawingCanvas.tsx`, `chat/DrawingSheet.tsx`): an answer's
  ` ```excalidraw ` block (Excalidraw's file or its skeleton form) and `.excalidraw` files in Files are
  drawn with Excalidraw (MIT), its own lazy chunk, never in the first bundle. Inline is view only; Open
  edits full size; Save writes back over the sha256 read, or a new `drawings/<name>.excalidraw` in the
  shared files folder (never over an existing file). Its fonts are served by McBot
  (`vite.config.ts` `excalidrawFonts`, CSP fonts are 'self'), the CJK one left out.
- Connections are agent-centred (Hermes' model): a model, tool, maker or chat app connects only to
  an agent. While a connection is drawn the rest dims; a refused drop says why. A selected block's
  wires say what they mean ("thinks with", "falls back to", "uses", "talks on", "makes images
  with", "hands work to"); unselected wires carry no label. Chains between
  them are workflows (M10).
- **Type:** San Francisco on a Mac (`-apple-system`; SF may not be shipped elsewhere, so Windows
  and Linux fall back to Segoe UI or Inter). `src/app/styles/premium.css` (before `glass.css` and `pro.css`) holds the
  type scale, hairlines, layered shadows and spring motion; reduced motion turns it off.
- **Everything structural is a graph.** The harness is the editable React Flow
  canvas; runs, memory and folders use the read-only `views/GraphCanvas.tsx`.
  Give each GraphCanvas a `key` per subject (root, run, agent) so React Flow
  state never leaks between subjects.
- **Logos:** tools, connectors, chat apps, model servers and makers show their brand's mark
  (`graph/Logo.tsx`, `nodeLogo`): `npm run site:logos` generates `src/app/lib/logos.generated.ts`
  from `design/logos/<key>.svg` (anyone can drop one in, under MIT, Apache or CC0; drawn as `<img>`, never
  HTML), Simple Icons (CC0, devDependency only) and, for services it lacks, LobeHub's icons (`LOBE_TOOLS`);
  the licences in `design/licences/` go into the app's third-party notices; `npm test` fails while it is stale. A brand colour is content,
  like note paper. No logo = the kind's own tile.
- **Faces:** agents are glass food bots (`src/app/faces/foods.ts`): the name picks
  the food and its `--food-*` colour, so the same name is always the same bot.
  An agent's expression is its run state: thinking, happy, sad. People are
  Blobatars with `tone={0.48}` (auto tone can be near-black on dark).
- **Logo:** the gray glass burger (`logoSvg`). The website's bots and the logo
  files (`site/assets/logo.svg`, `design/icon.svg`) are generated from the same
  code by `npm run site:foods`; `npm test` fails when they are stale. App icons: `npm run app:icon`
  (`scripts/app-icon.mjs`) renders the website's glass burger (`site/assets/burger.webp`, with its eyes) on
  a near-black tile: `design/icon-1024.png` on Apple's grid for macOS's `.icns`, `design/icon-full-1024.png`
  filling the canvas for Windows and Linux, and the site's `icon-180.png`.
- **Effects use block bodies.** `useEffect(() => { … })` — never a concise arrow:
  `scrollIntoView` returns a Promise in current Chromium, and an effect that
  returns a non-function crashes React on cleanup.
- **Dynamic island** (`src/app/shell/Island.tsx`): always in the middle of the title bar. At rest a
  pill that says how things are ("3 agents ready"); it grows (spring, `--ease-island`) into the most
  important thing now: an approval (answer inline), an agent at work with what it is doing (the tool
  in use, `lib/runStep.ts`), a compile, a new team message, a notice. It opens only when the pointer
  rests on it (240 ms) or on click / Enter — never because the pointer passes on its way to
  something under it — and, opened by hovering, closes when the pointer leaves; by click, on Esc or
  a click outside. Opened (600 px wide, scrolling rather than cutting off): what needs you, who works
  on what, today's spend and runs, the next scheduled run, a field to ask any agent (queued while it
  works, as in Chat), quick actions (Build a team, New agent, Compile, Invite, Team, Commands) and
  the window's Minimize / Maximize (app only). One height (30px) for every title-bar control. It
  also lists the last notices (`notices` in the store; Clear) and the doctor's findings with their
  fix (`applyFix` in `shell/DoctorSheet.tsx`), so nothing it covers is lost.
- **Rail** (`shell/Rail.tsx`): a few pinned views (default Home, Board, Chat, Tasks, Runs) and "…", a menu of every
  view with its shortcut and a pin toggle (pins kept per computer in localStorage); the view you are on shows even
  when it is not pinned. The app opens on Chat. The title bar stays calm: Compile shows on the Board, or anywhere
  when the agents' files are out of date or broken; the doctor appears only when it has findings; Share is an icon.
- **Messages just go:** a run refused as stale (409) compiles quietly and is sent again once (`runAgent`); only a
  compile that fails stops it, with its notice and "Fix".
- **Command palette** (`shell/Palette.tsx`, `lib/rank.ts`): ranked like a launcher: fuzzy fit (loose letter
  matching only on a command's name), then frecency (use counts, fading with age, kept in localStorage);
  empty shows "Suggested" (what you use most) first; a query nothing answers offers "Ask <agent>" as the
  last row; ⌘K / Ctrl+K on a row opens its actions (`Command.actions`); Tab on an "Ask…" row starts it.
- **Frameless window:** on Windows and Linux the main window has no native frame (`src-tauri/tauri.windows.conf.json`,
  `tauri.linux.conf.json`, and `new_window`); the title bar is the frame (drag region, `WindowControls` for
  minimize, maximize and close). macOS keeps its overlay title bar and traffic lights. The in-app island hangs
  from the top edge (flat on top, round underneath), like a notch.
- **Floating island** (desktop only; `src-tauri/src/lib.rs` `island`, `shell/IslandPill.tsx`, `lib/islandBridge.ts`):
  a small always-on-top window at the top centre of the screen, shown while no McBot window is in
  front and an agent works or asks (or every window is hidden, so it is the way back). Click brings
  McBot forward, its arrow hides McBot's windows, Allow once / Deny answer an approval from anywhere.
  The `main` window owns the state and sends a summary by events; the pill holds no board, no keys.
  Flush with the top edge of the screen: on Windows the window is transparent so the pill is round underneath;
  on macOS it stays a black rectangle (transparency needs a private API).
- **New agent** (`shell/NewAgentSheet.tsx`): 19 one-click starting cards in five groups (`agentSuggestions.ts`) fill
  name, purpose and soul, and name the Hermes library skills they start with; after the first compile those install
  one by one (`learnSkills` in `actions.ts`, `POST /api/skills/install`, host only). Starter teams (`graph/teams.ts`, 10)
  carry skills per member the same way, with one notice per team. Members and cards also bring their **tools** (catalog
  ids, e.g. web search) and **makers** (image, video), wired to them, so a designer makes the images itself and a
  researcher searches the web: agents do the work, not only describe it (owner's ask). A maker uses the service whose
  key the board's cloud model already has (`makerProvider`), else OpenRouter. Every skill id they name must be in
  `src/contracts/library.generated.ts` (`npm run engine:library` from `hermes/optional-skills` and `hermes/skills`;
  `npm test` fails while it is stale or a card names a skill Hermes doesn't ship). The demo's library is that list
  (all 141), and the Skills view lists Hermes' 44 built-in skills by name ("Show all").
- Views live behind an error boundary; a broken view must not blank the window.
- **Fast start:** only Home, Chat and Tasks are in the first bundle (`App.tsx` `lazyView`); the other views
  (Board with React Flow, Runs, Memory, Skills, Files, Cost, Team, Settings, Browser) are fetched one by one while
  the window is idle right after the first paint, so switching to them never waits; Code (Monaco) loads when opened.
  While the engine starts, the window asks it every 400 ms (every 5 s once it answers).
- An empty chat offers three starter questions picked from the agent's name, then its description
  (`chat/starters.ts`); one click sends it.
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
- **Add from GitHub** (`shell/GitHubSheet.tsx`, pure parts in `engine/github.ts`; ⌘K "Add from GitHub…", a
  GitHub link typed in ⌘K, or one pasted or dropped anywhere outside a text field; host only): the engine reads
  the repository through GitHub's API (`GET /api/github/inspect`; a saved `GITHUB_TOKEN` /
  `GITHUB_PERSONAL_ACCESS_TOKEN` raises the hourly limit; branch names with slashes are resolved the way
  GitHub's pages do) and says what it is: a **skill** (SKILL.md → an agent learns it, `POST /api/skills/add`),
  an **MCP server** (package.json on `@modelcontextprotocol/sdk` → a tool block `npx -y <package>`, or a Python
  project on `mcp` → `uvx --from git+<repo> <script>`, wired to the agent picked), a **Hermes plugin**
  (plugin.yaml → `POST /api/github/plugin`: `hermes -p <agent> plugins install owner/repo[/path] --enable
  --yes-deps`, docs/HERMES.md), or a **project** (`POST /api/github/download`: GitHub's archive unpacked with
  `tar` into the shared files folder's `github/<repo>`, 80 MB at most). Any of them can go to an agent as a
  question instead.
- **Browser start page** (`workbench/BrowserStart.tsx`, pure `lib/browserStore.ts`, kept per computer):
  one big field (address or search), favorites as brand tiles (`siteLogo`: Simple Icons marks, a few
  site keys added in `scripts/tool-logos.ts`), what answers on the usual local ports (asked of the
  engine's frameable probe), and recently visited pages. The address bar has Home, a favorite star
  and a key (Passwords for this site); the ask bar has one-click asks (Summarize, Key facts, Translate).
- **Passwords** (`views/PasswordsView.tsx`, rail "…" and ⌘K; hidden for people who joined): the
  person's site logins and the API keys (Settings' `KeysSection`). Logins live in
  `<workspace>/logins.json` (owner-only), each password sealed with AES-256-GCM under
  `<data>/logins.key` (owner-only, outside the workspace, so the McBot folder alone holds no readable
  password; `engine/logins.ts`). Lists never carry a password; `POST /api/logins/reveal` gives one to
  McBot's own window (loopback, allowed Origin) to copy or fill, never to a member (not in
  `guestAllowed`). Fill (`browser_fill` in `src-tauri/src/browser.rs`) runs only on the native page,
  only while it is on the login's site or a subdomain, and only over https (or this computer); it
  types into the page's fields and submits nothing. Hermes never sees logins. `SECRET_FILES`
  (`engine/profileEnv.ts`) keeps every file that holds keys (agents' `.env`, McBot's `secrets.json`,
  `logins.json`, `logins.key`, `sharing.json`) out of the Files view and the editor.
- **Browser view:** on macOS and Windows the page is a real child webview over the view's page
  area (`src-tauri/src/browser.rs`, Tauri `unstable` feature, one `page-<window>` per window), so
  sites that refuse iframes still load; it hides while a sheet or ⌘K is open (native views draw
  above HTML), and is placed again after layout and motion settle (the view has no entry motion).
  "Open in your browser" hands a page to the system browser (opener plugin: https, and http on
  localhost); `browser_open` (McBot's own window) is async, since a window built in a synchronous
  command deadlocks on Windows.
  Remote pages get no IPC. Linux (GTK ignores child bounds) and the demo use an iframe: the engine
  first asks whether the site allows framing (`GET /api/web/frameable`), and one that refuses
  gets "Open in a window" instead of a blank page. The same probe says whether the page answers at
  all (`reachable`), for every page shown, including links followed inside the native page
  (`browser:url`): a page that doesn't answer, or a window that is offline, gets McBot's own "Can't
  reach …" / "You're offline" screen with Try again, and the native page is hidden, so the web
  engine's own error page (on Windows, Edge's) is not what people see.

## Stack (do not substitute)

Tauri **2.x** (never 3, it is alpha) · React + TypeScript · React Flow
(`@xyflow/react`) · Yjs + y-websocket protocol · zod · zustand. No database, no
auth, no cloud: local JSON + the filesystem.

## Out of scope until asked

Auth, SSO, Langfuse, OpenTelemetry, a cloud tier, a marketplace, git
integration beyond showing status and diffs, A2A. (ACP is in: M9, owner's decision.) The terminal, code editor and browser panes are planned (M8).
Everything else on the way is ordered in `docs/PLAN.md` (M5–M16, reasons in
`docs/NEXT.md`, the strategy and competitors in `docs/STRATEGY.md`); build in that order. Postgres and Redis belong to the
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
  background so the glass stays see-through); `site/main.js` moves its pupils (in the eye holes)
  toward the cursor and makes it blink; a poke makes it happy. The bots in the page's windows and
  the crew at the end use `site/foods.js`. Clean and flat like a Mac page: system font, black and
  gray surfaces, white buttons; near-black cards with hairline borders, a floating nav, big tight
  type (Raycast-class finish, never its look or trade dress). Owner's rule: no gradients, glows,
  dotted grids or status dots, no gray boxes behind brand logos, and no scroll-jacking. The copy
  sells three reasons in plain words (no filler, no placeholder company names): yours (on your
  computer, private, never locked in), any model ("Switch models, not apps") and the harness you
  can see and change by drawing; then what a working team needs, a comparison, three steps, a FAQ
  and downloads. The live views (`site/main.js`, `site/style.css`: the hero window is the app as it
  opens, with its frameless window, rail and a chat that uses a tool, answers and asks before
  acting, so keep it in step with the app; then the model switch, the harness compiling, an
  approval, the ⌘K palette and the terminal) play only while on screen, hold their final state
  under `prefers-reduced-motion`, and use the page's flat colours; they are markup, not
  screenshots. Page anatomy (as the product pages we compare with do it): a split Download button
  (your OS, plus a menu) under the headline; moving rows of brand marks, each on its own colour
  ("Works with…"); cards whose bold title runs into the sentence; a two-column FAQ (`<details>`);
  download cards; a big footer with a one-paragraph pitch and link columns. Its share card
  `site/assets/og.jpg` (1200×630: the burger, the headline, the platforms) is rendered from HTML;
  render it again when the hero's words change. The brand rows are generated into
  `site/index.html` (between `<!-- logos:<group> -->` markers) by `npm run site:logos` from the
  app's own marks (`npm test` fails while they are stale).

Shortcuts: ⌘⇧Space McBot from anywhere · ⌘K commands · ⌘1–9 views (rail order: Home, Board, Chat, Tasks, Runs, Skills, Code, Browser, Files) · ⌘S compile · ⌘Z / ⇧⌘Z undo / redo · ⌘D duplicate · ⌘0 fit the board · right-click the board · ⌘N new window (desktop).
