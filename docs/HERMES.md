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
| `--source <tag>` is free-form (help text) | The gateway accepts only sources in its own contract; `--source mcbot` fails with "Gateway does not support source 'mcbot'". Omitted; one-shot runs default to `oneshot`. |
| Hermes docs: MCP tools are `mcp_<server>_<tool>` (`features/mcp.md:574`) | Code registers `mcp__<server>__<tool>`; the doc is stale. |
| `${workspaceFolder}` resolves to the session workspace | MCP servers start when the gateway boots, so it resolves to the gateway's own directory. The Files preset uses an absolute folder. |
| `hermes chat` is a plain CLI process | It auto-starts one multiplex **gateway** per Hermes root (`gateway.pid` JSON, idle-exit after 600 s) that also turns the root into a "default" profile home. The gateway re-scans config on change but discovers MCP servers **only at boot**, so after a config change the engine runs `hermes gateway stop` and waits for the pid to exit — a run started mid-teardown fails with "Gateway starting: deadline". Only done for McBot's own root, never an external `~/.hermes`. |
| Installing Hermes from a wheel | Refused by design; supported: installer, Docker, Nix, or the dev checkout (`scripts/run-in-hermes-env`). |

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
