# The Hermes mapping — verified

Every Hermes path, config key and CLI flag McBot writes or calls, with where it
was confirmed. Verified against **NousResearch/hermes-agent @ `1e208b2`**
(2026-11-03) by reading the source, running `hermes --help`, and running
compiled profiles through the real CLI. Line numbers refer to that commit.

Hard rule: nothing goes in here (or in `src/compile/`) without a source line or
a real run behind it. If Hermes changes, re-verify here first.

## Where a compiled agent lives

| Fact | Source |
|---|---|
| A named profile is `<root>/profiles/<name>/`; `<root>` is `HERMES_HOME` when set, else `~/.hermes` | `hermes_cli/profiles.py:2376-2404` (`profile_root_for_env_home`, `resolve_profile_env`) |
| So `HERMES_HOME=<out> hermes -p <name>` runs `<out>/profiles/<name>` — McBot's output root never touches `~/.hermes` | same; confirmed by real runs |
| Profile id grammar `^[a-z0-9][a-z0-9_-]{0,63}$` | `hermes_constants.py:401` (`PROFILE_ID_RE`) |
| Reserved names (`hermes default test tmp root sudo` + every subcommand) | `hermes_cli/profiles.py:275-282` |
| A profile is "live" only with an identity marker: `config.yaml .env SOUL.md profile.yaml auth.json state.db` | `hermes_constants.py:399,433-438` |
| Dirs `hermes profile create` bootstraps: `memories sessions skills skins logs plans workspace cron home` | `hermes_cli/profiles.py:40` (`_PROFILE_DIRS`) |
| `SOUL.md` sits at the profile root, injected verbatim as system-prompt slot #1 | `website/docs/user-guide/which-file-does-what.md`; `hermes_cli/profiles_initialization.py:36-48` |
| `profile.yaml` keys `description`, `display_name` | `hermes_cli/profiles.py:866-885` (`read_profile_meta`) |
| `.no-bundled-skills` marker: existence only; Hermes still seeds essential skills | `hermes_cli/profiles.py:99`, `tools/skills_sync.py:400` |

## config.yaml

Hermes parses config, profile.yaml and SKILL.md frontmatter as **YAML 1.1**
(`hermes_yaml.py`: ruamel, `version = (1, 1)`), so bare `yes/no/on/off/y/n` are
booleans and `0755` is octal. McBot emits YAML 1.1 so the library quotes them.

| Graph | config.yaml | Source |
|---|---|---|
| primary model | `model: { provider: custom:mcbot-<name>, default: <model id> }` | `website/docs/user-guide/configuring-models.md:135-146`; `custom:<key>` always targets the saved entry: `hermes_cli/runtime_provider_custom.py:132-146` |
| each model node | `providers.mcbot-<name>: { api, key_env?, default_model, transport: chat_completions }` | canonical v12 shape `hermes_cli/config_providers.py:287-303`; read by `runtime_provider_custom.py:79,148-180` (`api`/`url`/`base_url`, `key_env`/`api_key`, `default_model`, `api_mode`/`transport`) |
| `transport` value | `chat_completions` ∈ `_VALID_API_MODES` | `hermes_cli/runtime_provider.py:135` |
| fallback models (edge order ≥ 1) | `fallback_providers: [{ provider, model }]` | `hermes_cli/config_defaults.py:24`; `agent/agent_init_fallback.py:11-19` |
| tool node | `mcp_servers.<name>: { command, args, env }` or `{ url, headers }` | `website/docs/reference/mcp-config-reference.md`; read at `tools/mcp_tool_config.py:710` |
| — | **no** `_config_version` (an unversioned file is treated as current; "do not copy it into another config") | `cli-config.yaml.example:7-10`; `hermes_cli/config_migrations.py:878-887` |
| agent abilities (`capabilities`, when set or a video maker is wired) | `platform_toolsets: { cli: [<tool set keys>] }` — McBot's `--source mcbot` runs resolve on the `cli` surface | `gateway/session_policy.py:85-87,654-688` (`SURFACES`, `_resolve_toolsets` → `_get_platform_tools(config, 'cli')`); `hermes_cli/tools_config.py:571-646`; observed: only the listed tool sets reach the model |
| tool set keys | `web browser file terminal code_execution vision image_gen video_gen tts memory session_search skills todo clarify delegation cronjob kanban computer_use connections` | `hermes_cli/tools_config.py:67-93` (`CONFIGURABLE_TOOLSETS`) |
| unset list = Hermes' default for `cli` | every key above except `video_gen` and `kanban` | `_get_platform_tools({}, "cli")` run in `hermes/`; `tools_config.py:110` (`_DEFAULT_OFF_TOOLSETS`) |
| an explicit list keeps MCP servers | configured `mcp_servers` are added unless the list names some | `tools_config.py:733-753` (`_merge_mcp_servers`); run in `hermes/` |
| image maker | `image_gen: { provider, model? }` | `agent/image_gen_registry.py:28-40` (`image_gen.provider`); `plugins/image_gen/_common.py:71-82` and `hermes_cli/web_routers/tools.py:467` (`image_gen.model`); observed with provider `openai` |
| video maker | `video_gen: { provider, model? }` | `agent/video_gen_registry.py:5,30-37`; `hermes_cli/web_routers/tools.py:467` |
| maker ids and keys | image: `openai` OPENAI_API_KEY, `openrouter` OPENROUTER_API_KEY, `fal` FAL_KEY, `xai` XAI_API_KEY, `krea` KREA_API_KEY, `deepinfra` DEEPINFRA_API_KEY, `meta-ai` META_MODEL_API_KEY; video: `fal`, `openrouter`, `xai`, `deepinfra` (same keys) | `provider_id` / `name` in `plugins/image_gen/*/__init__.py`, `plugins/video_gen/*/__init__.py`; `requires_env` in each `plugin.yaml` |
| chat app with an own Bot API server | `platforms: { telegram: { extra: { base_url } } }` | `gateway/config_loader.py:138-171` (`merge_platform_sections`: top-level `platforms.*`); `plugins/platforms/telegram/adapter.py:3198-3202`; observed |

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
| One headless turn: `hermes -p <p> chat --query-file - --oneshot --format stream-json` | `hermes chat --help` (run); `website/docs/reference/cli-commands.md:127-186` |
| stream-json records: `system/init`, `text`, `tool_use`, `tool_result`, `result{session_id, exit_code, text, tokens{input,output,total,cache_read,cache_write}, duration_ms, error?}` | same doc; real captures in `test/fixtures/hermes-stream/` |
| `system/init` arrives with empty `model` and `session_id`; the real session id comes in `result` | observed |
| Exit codes: 0 ok, 1 failed, 130 interrupted | `cli-commands.md:186-198` |
| MCP tools are named **`mcp__<server>__<tool>`**, `[^A-Za-z0-9_]` → `_` | `tools/mcp_tool_schema.py:147-185`; observed |
| Deferred MCP tools may be called through the `tool_call` bridge: `{name, arguments}` or `{calls:[…]}` | `tools/tool_labels.py:148-163`; observed |
| `image_generate` returns `{"success": true, "image": "<path>"}` and saves into the **profile's** `cache/generated/images/`; `video_generate` returns `{"video": "<path>"}` | `agent/image_gen_provider.py:83-123`; `agent/video_gen_provider.py:75-120`; observed |
| `image_generate` may be deferred behind `tool_search` / `tool_call` like MCP tools | observed |
| Per-session tokens and cost: `state.db` table `sessions` (`model, billing_provider, billing_base_url, input_tokens, output_tokens, estimated_cost_usd, actual_cost_usd, cost_status, …`) in the **profile's** home | `hermes_state_common.py:461-507`; `hermes_state.py:181` |
| Custom/local endpoints are recorded with `cost_status: unknown`, `estimated_cost_usd: 0` | observed |
| `fallback_providers` failover: primary on a dead port, the turn is answered by the fallback and recorded as `billing_provider: custom:mcbot-<fallback>` | observed |

## Memory

`<profile>/memories/MEMORY.md` and `USER.md`; entries joined by `"\n§\n"`, no
trailing newline (`tools/memory_tool_store.py:26,697-713`). Budgets 2200 / 1375
chars (`hermes_cli/config_defaults.py:1298-1313`). Hermes takes an `flock` on
`<file>.lock` (`memory_tool_store.py:259-298`); Node cannot, so McBot refuses
edits while a run of that profile is active and requires the sha256 the editor
read (optimistic concurrency). Hermes memory has **no "pin"** — McBot does not
invent one.

## Things that differ from what we were told

| Claim | Reality |
|---|---|
| "model → `models:` key" | Hermes has no top-level `models:`; per-provider `providers.<name>.models` exists but is optional. Not written. |
| `--source <tag>` is free-form (help text) | Upstream accepts only its own labels (`gateway/session_policy.py` `SURFACES`, `tui_gateway/contracts/canonical_sessions.py`). Our fork adds `mcbot` (`hermes/MCBOT.md`), so McBot's own Hermes runs with `--source mcbot`; an external Hermes gets no `--source` and records `oneshot`. |
| Hermes docs: MCP tools are `mcp_<server>_<tool>` (`features/mcp.md:574`) | Code registers `mcp__<server>__<tool>`; the doc is stale. |
| `${workspaceFolder}` resolves to the session workspace | MCP servers start when the gateway boots, so it resolves to the gateway's own directory. The Files preset uses an absolute folder. |
| `hermes chat` is a plain CLI process | It auto-starts one multiplex **gateway** per Hermes root (`gateway.pid` JSON, idle-exit after 600 s) that also turns the root into a "default" profile home. The gateway re-scans config on change but discovers MCP servers **only at boot**, so after a config change the engine runs `hermes gateway stop` and waits for the pid to exit — a run started mid-teardown fails with "Gateway starting: deadline". Only done for McBot's own root, never an external `~/.hermes`. |
| A key in a run's environment reaches the agent | The gateway serves every profile of a root and reads a served profile's keys from **`<profile>/.env` only**; a miss never falls back to the gateway's environment (`agent/secret_scope.py:230-247` `get_secret`, `:407-417` `build_profile_secret_scope`; `gateway/session_local.py:205-218`). Observed: a cloud model's saved key arrived as `Bearer no-key-required`. The engine now writes the keys an agent names into its `.env` before each run (`engine/profileEnv.ts`); the same holds for any setting Hermes reads with `get_secret`, e.g. `OPENAI_BASE_URL`. |
| A chat app needs `hermes gateway setup` or a platform switch in config | A served profile's bot starts when its `.env` has the platform token: Telegram is enabled by `TELEGRAM_BOT_TOKEN` (`plugins/platforms/telegram/gateway_env.py:12-19`). Under the multiplex gateway every profile gets its own adapters, started under its own home and secret scope (`gateway/run_adapters.py:960-1010`; `website/docs/developer-guide/multiplexing-gateway.md` "Per-credential bot, no route"). Who may talk to it is `TELEGRAM_ALLOWED_USERS` (comma-separated numeric ids), read from **that profile's** scope (`gateway/platforms/_shared.py:69-86` `platform_gate_env`); with no list, unknown senders are refused (`gateway/run_startup.py:1075-1090`). A changed `config.yaml` or `.env` reconnects that profile's adapters (`gateway/run_profile_reconcile.py:50-65`). Observed end to end against a stub Bot API: the allowed user got the agent's answer, another user got nothing. |
| A gateway with a chat app stops when idle | An idle-exit gateway stays up while any messaging adapter is configured or connected (`gateway/run_idle_exit.py:1-20`). `hermes gateway ensure` starts one without idle exit, as Hermes' desktop app does (`hermes gateway ensure --help`; `hermes_cli/gateway_runtime_start.py:43-61`). The engine runs it after a compile, a saved key, a board save and at start, whenever a compiled agent has a bot with a saved token. |
| A system proxy honours `NO_PROXY` for a custom Telegram `base_url` | The adapter matches `NO_PROXY` against `api.telegram.org` and its fallback IPs only (`plugins/platforms/telegram/adapter.py:3003-3006` `resolve_proxy_url`), so a local Bot API server is reached through `HTTPS_PROXY` when one is set. The e2e test clears the proxy variables for its stub. |
| Installing Hermes from a wheel | Refused by design; supported: installer, Docker, Nix, or the dev checkout (`scripts/run-in-hermes-env`). |

## McBot's own Hermes (hermes/)

| Fact | Source |
|---|---|
| A checkout runs through `scripts/run-in-hermes-env CMD…`: it checks the environment and, when stale, runs `setup-hermes.sh --runtime-only` before exec'ing CMD | `hermes/scripts/run-in-hermes-env`, `hermes/scripts/_activation.sh:25-31,117-126` |
| Tools (Python, uv, Node, ripgrep…) live in a store: `HERMES_RUNTIME_DIR`, else `<repo>/../tools`, else `$HERMES_HOME/tools`; a `python-*` dir there means the runtime exists | `hermes/scripts/_activation.sh:34-48` (`hermes_bootstrap_python`) |
| A launch that carries `__HERMES_ACTIVATED` (a current activation) skips the check: 2.6 s → 0.2 s per launch, measured | `_activation.sh:85-115` (`hermes_activation_current`); observed |
| The installed environment is registered per Hermes home (`<home>/installs/<hash>/facts.json`), so activation is per home; a fresh home without one fails with "no dependency environment is committed for this install" | observed |
| `HERMES_MANAGED=<name>` marks a package-managed install: `hermes update` refuses with a message naming it | `hermes/hermes_constants.py:854-876` (`get_managed_system`); `hermes/hermes_cli/main.py:2282` |
| …and a managed install does not create or secure its home's folders (`cron`, `sessions`, `logs`, `memories` must exist) | `hermes/hermes_cli/config_home.py:56-66` (`initialize_home`). So McBot's runs never set it; only `npm run hermes` does |
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
