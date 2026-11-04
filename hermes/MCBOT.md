# McBot's changes to Hermes Agent

This directory is [Hermes Agent](https://github.com/NousResearch/hermes-agent)
(MIT, © Nous Research; see `LICENSE`) at the upstream commit in
`UPSTREAM.json`, plus the changes below. Each one is marked `McBot:` in the
code. Keep them few and small, so that `npm run hermes:sync -- <checkout>`
can three-way merge every upstream release into them.

| File | Change | Why |
|---|---|---|
| `gateway/session_policy.py` | `mcbot` is a session surface (runs as the CLI) and keeps its own stored label | Runs McBot starts are recorded as McBot's (`--source mcbot`) |
| `tui_gateway/contracts/canonical_sessions.py` | `mcbot` is an accepted `session.create` source | Same |
| `hermes_state_sessions.py` | `mcbot` sessions stay out of human session pickers | Same treatment as `oneshot` runs |
| `tui_gateway/methods_projects.py` | `mcbot` sessions stay out of project trees | Same |
| `gateway/session_worker_delegation.py` | `mcbot` sessions may register delegated work | Same as `oneshot` |
| `agent/managed_worker.py` | `mcbot` is a CLI-surface label | Same as `tool` and `oneshot` |
| `agent/prompt_caching.py` | `mcbot` runs are machine-paced (short cache) | Same as `oneshot` |
| `hermes_cli/config.py` | With `HERMES_MANAGED=mcbot`, refusals say Hermes is part of McBot | `npm run hermes -- update` explains that updates arrive with McBot |

Not changed on purpose: home initialisation. McBot's runs do not set
`HERMES_MANAGED`, because a managed install stops creating and securing its
home's folders (`hermes_cli/config_home.py`, `initialize_home`).
