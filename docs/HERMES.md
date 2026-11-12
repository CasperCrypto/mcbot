# The Hermes mapping — verified

Every Hermes path, config key and CLI flag McBot writes or calls, with where it
was confirmed. Verified against **NousResearch/hermes-agent v0.23.1 @ `3b42157`**
(2026-11-09) by reading the source, running `hermes --help`, and running
compiled profiles through the real CLI. Line numbers refer to that commit.

Last sync (2026-11-11, from `1e208b2`): every line cited here was found again,
unchanged, at v0.23.1 and its number updated; the tool set list lost only
`yuanbao` (moved to a plugin, never used by McBot); `_get_platform_tools({}, "cli")`
still returns McBot's `DEFAULT_CAPABILITIES`; the sessions table McBot reads
has the same columns; and the real-Hermes tests (`MCBOT_E2E=1 npm test`) pass.

Hard rule: nothing goes in here (or in `src/compile/`) without a source line or
a real run behind it. If Hermes changes, re-verify here first.

## Where a compiled agent lives

| Fact | Source |
|---|---|
| A named profile is `<root>/profiles/<name>/`; `<root>` is `HERMES_HOME` when set, else `~/.hermes` | `hermes_cli/profiles.py:2324-2352` (`profile_root_for_env_home`, `resolve_profile_env`) |
| So `HERMES_HOME=<out> hermes -p <name>` runs `<out>/profiles/<name>` — McBot's output root never touches `~/.hermes` | same; confirmed by real runs |
| Profile id grammar `^[a-z0-9][a-z0-9_-]{0,63}$` | `hermes_constants.py:401` (`PROFILE_ID_RE`) |
| Reserved names (`hermes default test tmp root sudo` + every subcommand) | `hermes_cli/profiles.py:280-287` |
| A profile is "live" only with an identity marker: `config.yaml .env SOUL.md profile.yaml auth.json state.db` | `hermes_constants.py:399,433-438` |
| Dirs `hermes profile create` bootstraps: `memories sessions skills skins logs plans workspace cron home` | `hermes_cli/profiles.py:43` (`_PROFILE_DIRS`) |
| `SOUL.md` sits at the profile root, injected verbatim as system-prompt slot #1 | `website/docs/user-guide/which-file-does-what.md`; `hermes_cli/profiles_initialization.py:36-48` |
| `profile.yaml` keys `description`, `display_name` | `hermes_cli/profiles.py:874-893` (`read_profile_meta`) |
| `.no-bundled-skills` marker: existence only; Hermes still seeds essential skills | `hermes_cli/profiles.py:102`, `tools/skills_sync.py:400` |

## config.yaml

Hermes parses config, profile.yaml and SKILL.md frontmatter as **YAML 1.1**
(`hermes_yaml.py`: ruamel, `version = (1, 1)`), so bare `yes/no/on/off/y/n` are
booleans and `0755` is octal. McBot emits YAML 1.1 so the library quotes them.

| Graph | config.yaml | Source |
|---|---|---|
| primary model | `model: { provider: custom:mcbot-<name>, default: <model id> }` | `website/docs/user-guide/configuring-models.md:137-148`; `custom:<key>` always targets the saved entry: `hermes_cli/runtime_provider_custom.py:132-146` |
| each model node | `providers.mcbot-<name>: { api, key_env?, default_model, transport: chat_completions }` | canonical v12 shape `hermes_cli/config_providers.py:287-303`; read by `runtime_provider_custom.py:79,148-180` (`api`/`url`/`base_url`, `key_env`/`api_key`, `default_model`, `api_mode`/`transport`) |
| `transport` value | `chat_completions` ∈ `_VALID_API_MODES` | `hermes_cli/runtime_provider.py:135` |
| fallback models (edge order ≥ 1) | `fallback_providers: [{ provider, model }]` | `hermes_cli/config_defaults.py:24`; `agent/agent_init_fallback.py:11-19` |
| tool node | `mcp_servers.<name>: { command, args, env }` or `{ url, headers }` | `website/docs/reference/mcp-config-reference.md`; read at `tools/mcp_tool_config.py:719` |
| — | **no** `_config_version` (an unversioned file is treated as current; "do not copy it into another config") | `cli-config.yaml.example:7-10`; `hermes_cli/config_migrations.py:884-893` |
| agent browser settings (only what differs from Hermes' defaults) | `browser: { headed: true, engine: lightpanda, use_real_profile: true }` | `hermes_cli/config_defaults.py:410-445` (`headed`: a visible Chromium window; `engine`: `auto` or `lightpanda`, `lightpanda` on PATH; `use_real_profile`: a snapshot of the person's own Chromium profile); read per profile by `tools/browser_session_cloud.py:23,35-51,126-153`; observed: a compiled profile reads `engine lightpanda, headed True` |
| agent abilities (`capabilities`, when set or a video maker is wired) | `platform_toolsets: { cli: [<tool set keys>] }` — McBot's `--source mcbot` runs resolve on the `cli` surface | `gateway/session_policy.py:86-88,659-693` (`SURFACES`, `_resolve_toolsets` → `_get_platform_tools(config, 'cli')`); `hermes_cli/tools_config.py:572-647`; observed: only the listed tool sets reach the model |
| tool set keys | `web browser file terminal code_execution vision image_gen video_gen tts memory session_search skills todo clarify delegation cronjob kanban computer_use connections` | `hermes_cli/tools_config.py:69-95` (`CONFIGURABLE_TOOLSETS`) |
| unset list = Hermes' default for `cli` | every key above except `video_gen` and `kanban` | `_get_platform_tools({}, "cli")` run in `hermes/`; `tools_config.py:111` (`_DEFAULT_OFF_TOOLSETS`) |
| an explicit list keeps MCP servers | configured `mcp_servers` are added unless the list names some | `tools_config.py:734-754` (`_merge_mcp_servers`); run in `hermes/` |
| image maker | `image_gen: { provider, model? }` | `agent/image_gen_registry.py:28-40` (`image_gen.provider`); `plugins/image_gen/_common.py:71-82` and `hermes_cli/web_routers/tools.py:467` (`image_gen.model`); observed with provider `openai` |
| video maker | `video_gen: { provider, model? }` | `agent/video_gen_registry.py:5,30-37`; `hermes_cli/web_routers/tools.py:467` |
| maker ids and keys | image: `openai` OPENAI_API_KEY, `openrouter` OPENROUTER_API_KEY, `fal` FAL_KEY, `xai` XAI_API_KEY, `krea` KREA_API_KEY, `deepinfra` DEEPINFRA_API_KEY, `meta-ai` META_MODEL_API_KEY; video: `fal`, `openrouter`, `xai`, `deepinfra` (same keys) | `provider_id` / `name` in `plugins/image_gen/*/__init__.py`, `plugins/video_gen/*/__init__.py`; `requires_env` in each `plugin.yaml` |
| chat app with an own Bot API server | `platforms: { telegram: { extra: { base_url } } }` | `gateway/config_loader.py:138-171` (`merge_platform_sections`: top-level `platforms.*`); `plugins/platforms/telegram/adapter.py:2994-2998`; observed |

`mcbot-` prefixes the provider key so a model node can never shadow a built-in
provider id (`openrouter`, `anthropic`, …). API keys are never written: only the
env var name (`key_env`).

## Skills

`<profile>/skills/<name>/SKILL.md`, frontmatter `name, description, version,
author, license, platforms, metadata.hermes.tags` (`skills/AGENTS.md`).
Discovery walks the tree recursively, so a flat `skills/<name>/` works
(`agent/skill_utils.py:878-887`). Descriptions are capped at 60 chars, Hermes'
authoring standard.

## Running and observing

| Fact | Source |
|---|---|
| One headless turn: `hermes -p <p> chat --query-file - --oneshot --format stream-json` | `hermes chat --help` (run); `website/docs/reference/cli-commands.md:128-187` |
| stream-json records: `system/init`, `text`, `tool_use`, `tool_result`, `result{session_id, exit_code, text, tokens{input,output,total,cache_read,cache_write}, duration_ms, error?}` | same doc; real captures in `test/fixtures/hermes-stream/` |
| `system/init` arrives with empty `model` and `session_id`; the real session id comes in `result` | observed |
| Exit codes (`chat --oneshot`): 0 ok, 1 failed or partial, 130 interrupted; 75 and the provider-wall codes are for task-board workers only | `hermes_cli/turn_exit.py:16-43` (`turn_exit_code`); `website/docs/reference/cli-commands.md:192-205` |
| MCP tools are named **`mcp__<server>__<tool>`**, `[^A-Za-z0-9_]` → `_` | `tools/mcp_tool_schema.py:147-185`; observed |
| Deferred MCP tools may be called through the `tool_call` bridge: `{name, arguments}` or `{calls:[…]}` | `tools/tool_labels.py:148-163`; observed |
| `image_generate` returns `{"success": true, "image": "<path>"}` and saves into the **profile's** `cache/generated/images/`; `video_generate` returns `{"video": "<path>"}` | `agent/image_gen_provider.py:83-123`; `agent/video_gen_provider.py:75-120`; observed |
| `image_generate` may be deferred behind `tool_search` / `tool_call` like MCP tools | observed |
| Per-session tokens and cost: `state.db` table `sessions` (`model, billing_provider, billing_base_url, input_tokens, output_tokens, estimated_cost_usd, actual_cost_usd, cost_status, …`) in the **profile's** home | `hermes_state_common.py:467-513`; `hermes_state.py:181` |
| Custom/local endpoints are recorded with `cost_status: unknown`, `estimated_cost_usd: 0` | observed |
| `fallback_providers` failover: primary on a dead port, the turn is answered by the fallback and recorded as `billing_provider: custom:mcbot-<fallback>` | observed |

## Memory

`<profile>/memories/MEMORY.md` and `USER.md`; entries joined by `"\n§\n"`, no
trailing newline (`tools/memory_tool_store.py:26,697-713`). Budgets 2200 / 1375
chars (`hermes_cli/config_defaults.py:1295-1310`). Hermes takes an `flock` on
`<file>.lock` (`memory_tool_store.py:259-298`); Node cannot, so McBot refuses
edits while a run of that profile is active and requires the sha256 the editor
read (optimistic concurrency). Hermes memory has **no "pin"** — McBot does not
invent one.

## Tasks: Hermes' kanban

| Fact | Source |
|---|---|
| One board per Hermes home, shared by every profile in it ("forking the board per profile would break the dispatcher/worker handoff"): `kanban_home()` is `HERMES_KANBAN_HOME`, else the default root; the default board's database is `<root>/kanban.db` | `hermes_cli/kanban_db.py:401-409` (`kanban_home`), `:563-566` (`kanban_db_path`), `:330` (`DEFAULT_BOARD`); observed: `hermes -p triage kanban create … --assignee writer` and `hermes -p writer kanban list` read the same `<root>/kanban.db` |
| Tables McBot reads: `tasks`, `task_links (parent_id, child_id)`, `task_comments`, `task_runs` (one row per attempt; a worker's `kanban_complete --summary` lands in `task_runs.summary`, not `tasks.result`); times are Unix seconds | `hermes_cli/kanban_db.py:777-955` (`SCHEMA_SQL`); observed |
| Statuses, in Hermes' column order: `triage todo scheduled ready running blocked review done`, plus `archived` | `hermes_cli/kanban_workflow.py:114-142` (`DEFAULT_WORKFLOW`, `DEFAULT_STATUSES`) |
| Task ids are `t_` + 8 hex | `hermes_cli/kanban_db.py:988-991` (`_new_task_id`) |
| `hermes kanban create <title> --body-file - --assignee <profile> --parent <id> --created-by <name> --json` (prints the task as JSON); `comment <id> <text…> --author <name>`; `assign <id> <profile\|none>`; `complete <id> --result <text>`; `block <id> [reason…]`; `unblock <id>`; `reopen-review <id> --reason <text>` (a person's "ask for changes": review → ready); `archive <id>`. McBot puts free text after `--` | `hermes_cli/kanban_parser.py:160-372`; `hermes kanban <cmd> --help`; observed |
| A ready task with an assignee starts only while the root's gateway runs: it embeds the dispatcher (`kanban.dispatch_in_gateway`, default true; a tick every `kanban.dispatch_interval_seconds`, default 60). Without a gateway, tasks stay in `ready` | `gateway/kanban_watchers.py:209-262`, `gateway/kanban_watchers_dispatcher.py:49`; `hermes kanban init` prints the same. The engine runs `hermes gateway ensure` after a person creates, assigns or unblocks a task |
| The dispatcher hands the task to its profile's owner in the gateway (`hermes_cli.kanban_worker_client`), with `HERMES_KANBAN_TASK` set, so the worker gets the task-scoped tools (`kanban_complete`, `kanban_block`, `kanban_comment`, `kanban_create`, …) without the `kanban` tool set | `hermes_cli/kanban_db_dispatch.py:2697-2700,2754-2873`; `tools/kanban_tools.py:83-90` (`_visible`); observed: a worker on the stub model called `kanban_complete` and the task went `ready → running → done` |
| Outside a dispatched task, an agent gets the kanban tools (create, list, link, unblock…) only with the `kanban` tool set in its `platform_toolsets` | `tools/kanban_tools.py:1-5,37,83-96`; `toolsets.py:153-163` |

## Schedules: Hermes' cron

| Fact | Source |
|---|---|
| Cron is per profile: each agent's jobs live in `<profile>/cron/jobs.json` as `{ jobs: [...], updated_at }` and run with that profile's `.env`, config and skills | `cron/jobs.py:82-95` (comment and `JOBS_FILE`), `:1377` (`load_jobs`); observed |
| Job fields McBot reads: `id` (12 hex), `name`, `prompt`, `schedule_display`, `enabled`, `state`, `next_run_at`, `last_run_at`, `last_status`, `last_error` | `cron/jobs.py:1866` (`uuid4().hex[:12]`); a job `hermes -p triage cron create` wrote |
| `hermes -p <agent> cron create [--name N] <schedule> [prompt]` (schedule: `30m`, `every 2h` or a cron line); `pause`, `resume`, `run` (on the next scheduler tick), `remove` `<job_id>` | `hermes_cli/subcommands/cron.py:39,188-207`; `hermes cron <cmd> --help` |
| Jobs fire only while a gateway serves the profile ("Scheduler is not ready … no gateway serves it"). The engine runs `hermes gateway ensure` after a schedule is added, resumed or run, and at start while any compiled agent has an enabled job | `hermes cron create` output; observed: `cron run` fired within seconds under the multiplex gateway, `last_status: ok` |

## Runs over Hermes' API server (approvals) — used for McBot's own Hermes

What approval cards are built on. Verified end to end against the stub model on 2026-11-12:
a run asked to `rm -rf`, Hermes paused with `approval.request`, McBot answered `once`, the
command ran, the run completed. McBot's own Hermes now runs every agent this way
(`engine/hermesRuns.ts`, `engine/runner.ts` `executeApi`); an external Hermes keeps one-shot
`hermes chat`. `engine/engine.test.ts` ("asks the person before a risky command…") checks it.

| Fact | Source |
|---|---|
| The gateway starts its API server when its environment has `API_SERVER_KEY` (16+ characters); `API_SERVER_PORT` and `API_SERVER_HOST` set where it listens (default 8642) | `gateway/config_env.py:121-129` (`_api_server`), `gateway/config.py:550-565`; `gateway/platforms/api_server.py:165-168` |
| Under the multiplex gateway each profile is at `/p/<profile>/v1/...`, authorized by that profile's own `API_SERVER_KEY` (its `.env`); no key there = 401 | `gateway/platforms/api_server.py:1-6`, `:1389-1430` (`_expected_api_key`, `_check_auth`); `gateway/config_env.py:111-113` |
| `POST /v1/runs` with `{"input": "<prompt>"}` → 202 `{"run_id": "run_…", "status": "started"}` | `gateway/platforms/api_server_runs.py:285-292,768-860`; observed |
| `GET /v1/runs/{id}/events` is SSE: `data: {"event", "run_id", "timestamp", "seq", …}`, `: keepalive` comments. Seen: `tool.started {tool, preview, tool_call_id}`, `approval.request {kind, prompt_id, execution_generation, command, description, choices}`, `approval.settled {prompt_id}`, `tool.completed {tool, duration, error}`, `message.delta {delta}`, `run.completed {output, usage: {input_tokens, output_tokens, total_tokens}, runtime}` | `api_server_runs.py:224-226` (`_run_event`), `:1256` (`_handle_run_events`); observed |
| Answer: `POST /v1/runs/{id}/approval` with exactly `{"request_id": <prompt_id>, "execution_generation": <n>, "choice": "once"\|"session"\|"always"\|"deny"}` → `{"status": "resolved"}`; any other key set → 400 `invalid_params` | `gateway/platforms/api_server_authority_runs.py:114-136` (`respond_run`); observed |
| Whether a command asks: `approvals.mode` (`smart` by default: a guardian model decides and escalates; `manual` always asks for dangerous commands); one-shot `hermes chat` runs use `approvals.single_query_mode` (`deny`), which is why McBot's runs today never ask | `hermes_cli/config_defaults.py:1646-1662` |
| A run's tools come from `platform_toolsets.api_server`, not `cli`; unset = Hermes' API default (the CLI default minus `clarify`, `computer_use`, `tts`). So compile writes chosen abilities to both surfaces | `gateway/platforms/api_server.py:2196,2215` (`_get_platform_tools(user_config, "api_server")`); `hermes_cli/tools_config.py:572-582`; observed (`web_search` offered while only `cli` was set) |
| `tool.completed` carries `preview` (the result, secret-redacted, at most 500 characters) — on the admitted-turn path only after McBot's patch passes `result=` on (`hermes/MCBOT.md`); `duration` is 0 there, so McBot times the tool itself | `gateway/platforms/api_server_runs.py:142-157,386-388,1126-1130` |
| The run's session lands in the profile's `state.db` with source `api_server`; `GET /v1/runs/{id}` gives its `session_id`, so cost reads it as before | `api_server.py:1601` (`_SESSION_SOURCE`); observed |
| McBot keeps the key and port in `<workspace>/gateway.json` (owner-only; port picked free once) and writes `API_SERVER_KEY/PORT/HOST` into the root's and every profile's `.env` key block | `engine/hermesRuns.ts` (`gatewayApi`, `apiEnv`) |
| A port another process holds parks the API server ("Port … already in use") while the gateway keeps running | observed in `gateway.log` |

## Things that differ from what we were told

| Claim | Reality |
|---|---|
| "model → `models:` key" | Hermes has no top-level `models:`; per-provider `providers.<name>.models` exists but is optional. Not written. |
| `--source <tag>` is free-form (help text) | Upstream accepts only its own labels (`gateway/session_policy.py` `SURFACES`, `tui_gateway/contracts/canonical_sessions.py`). Our fork adds `mcbot` (`hermes/MCBOT.md`), so McBot's own Hermes runs with `--source mcbot`; an external Hermes gets no `--source` and records `oneshot`. |
| Hermes docs: MCP tools are `mcp_<server>_<tool>` (`website/docs/user-guide/features/mcp.md:574`) | Code registers `mcp__<server>__<tool>` (`tools/mcp_tool_schema.py:159`, `MCP_TOOL_NAME_PREFIX`); the doc is still stale at v0.23.1. |
| `${workspaceFolder}` resolves to the session workspace | MCP servers start when the gateway boots, so it resolves to the gateway's own directory. The Files preset uses an absolute folder. |
| `hermes chat` is a plain CLI process | It auto-starts one multiplex **gateway** per Hermes root (`gateway.pid` JSON, idle-exit after 600 s) that also turns the root into a "default" profile home. The gateway re-scans config on change but discovers MCP servers **only at boot**, so after a config change the engine runs `hermes gateway stop` and waits for the pid to exit — a run started mid-teardown fails with "Gateway starting: deadline". Only done for McBot's own root, never an external `~/.hermes`. |
| A key in a run's environment reaches the agent | The gateway serves every profile of a root and reads a served profile's keys from **`<profile>/.env` only**; a miss never falls back to the gateway's environment (`agent/secret_scope.py:230-247` `get_secret`, `:407-417` `build_profile_secret_scope`; `gateway/session_local.py:205-218`). Observed: a cloud model's saved key arrived as `Bearer no-key-required`. The engine now writes the keys an agent names into its `.env` before each run (`engine/profileEnv.ts`); the same holds for any setting Hermes reads with `get_secret`, e.g. `OPENAI_BASE_URL`. |
| A chat app needs `hermes gateway setup` or a platform switch in config | A served profile's bot starts when its `.env` has the platform token: Telegram is enabled by `TELEGRAM_BOT_TOKEN` (`plugins/platforms/telegram/gateway_env.py:12-19`). Under the multiplex gateway every profile gets its own adapters, started under its own home and secret scope (`gateway/run_adapters.py:974-1024`; `website/docs/developer-guide/multiplexing-gateway.md` "Per-credential bot, no route"). Who may talk to it is `TELEGRAM_ALLOWED_USERS` (comma-separated numeric ids), read from **that profile's** scope (`gateway/platforms/_shared.py:69-86` `platform_gate_env`); with no list, unknown senders are refused (`gateway/run_startup.py:1095-1110`). A changed `config.yaml` or `.env` reconnects that profile's adapters (`gateway/run_profile_reconcile.py:50-65`). Observed end to end against a stub Bot API: the allowed user got the agent's answer, another user got nothing. |
| A gateway with a chat app stops when idle | An idle-exit gateway stays up while any messaging adapter is configured or connected (`gateway/run_idle_exit.py:1-20`). `hermes gateway ensure` starts one without idle exit, as Hermes' desktop app does (`hermes gateway ensure --help`; `hermes_cli/gateway_runtime_start.py:43-61`). The engine runs it after a compile, a saved key, a board save and at start, whenever a compiled agent has a bot with a saved token. |
| A system proxy honours `NO_PROXY` for a custom Telegram `base_url` | Upstream matched `NO_PROXY` against `api.telegram.org` and its fallback IPs only (`resolve_proxy_url` in `plugins/platforms/telegram/adapter.py`), so a local Bot API server went through `HTTPS_PROXY`. **Fixed in our fork** (`hermes/MCBOT.md`): with a `base_url`, its host is the one checked. The e2e test runs with the sandbox's proxy set and passes. |
| Installing Hermes from a wheel | Refused by design; supported: installer, Docker, Nix, or the dev checkout (`scripts/run-in-hermes-env`). |

## McBot's own Hermes (hermes/)

| Fact | Source |
|---|---|
| A checkout runs through `scripts/run-in-hermes-env CMD…`: it checks the environment and, when stale, runs `setup-hermes.sh --runtime-only` before exec'ing CMD | `hermes/scripts/run-in-hermes-env`, `hermes/scripts/_activation.sh:25-31,117-126` |
| Tools (Python, uv, Node, ripgrep…) live in a store: `HERMES_RUNTIME_DIR`, else `<repo>/../tools`, else `$HERMES_HOME/tools`; a `python-*` dir there means the runtime exists | `hermes/scripts/_activation.sh:34-48` (`hermes_bootstrap_python`) |
| A launch that carries `__HERMES_ACTIVATED` (a current activation) skips the check: 2.6 s → 0.2 s per launch, measured | `_activation.sh:85-115` (`hermes_activation_current`); observed |
| The installed environment is registered per Hermes home (`<home>/installs/<hash>/facts.json`), so activation is per home; a fresh home without one fails with "no dependency environment is committed for this install" | observed |
| `HERMES_MANAGED=<name>` marks a package-managed install: `hermes update` refuses with a message naming it | `hermes/hermes_constants.py:854-876` (`get_managed_system`); `hermes/hermes_cli/main.py:2199` |
| …and a managed install does not create or secure its home's folders (`cron`, `sessions`, `logs`, `memories` must exist) | `hermes/hermes_cli/config_home.py:56-66` (`initialize_home`). So McBot's runs never set it; only `npm run cli` does |
| `python -m pm.environments --format json` (cwd = the checkout, `PYTHONPATH` = the checkout) prints the full environment for the current `HERMES_HOME`; its `PYTHONPATH` lists `<home>/installs/…/site-packages` only once that home has dependencies. McBot launches Hermes' Python with it, no bash runner | `hermes/pm/environments.py:594`; observed |
| `setup-hermes.sh --runtime-only` / `setup-hermes.ps1 -RuntimeOnly` installs tools into the store and dependencies for the current `HERMES_HOME` | `hermes/setup-hermes.sh:20-26`, `hermes/setup-hermes.ps1:15,100`; observed |
| A new home's gateway can take longer to boot than the client waits: the run fails with "Gateway starting: deadline", the next one succeeds | `hermes_cli/gateway_chat.py`; observed in the installed app |
| `hermes_cli/_version.py` is generated by releases, so a checkout reports `vunknown`; McBot shows the upstream commit from `hermes/UPSTREAM.json` | `hermes/.gitignore`; observed |

## Not verified here

- **A real model.** No model host was reachable from the build machine, so every
  run used `test/stub-llm/` — a deterministic OpenAI-compatible server. It proves
  the compiled profile is read, routed to the configured endpoint, and that
  tools, memory and cost flow through real Hermes. Point a model node at Ollama
  (`http://127.0.0.1:11434/v1`) or LM Studio to see a real answer.
- **The cron, approvals and memory-config mappings** are verified as paths/keys
  but not compiled: those node kinds are not in M0–M4. `cron/jobs.json` holds
  scheduler state (`next_run_at`, `pending_slot`), so schedules should be
  created through `hermes cron add`, not by writing the file.
- **Windows and macOS.** Built and run on Linux only (`cargo check`, a debug
  Tauri build under Xvfb). The Hermes binary lookup handles `.cmd` shims and
  `PATHEXT`, untested on Windows.
