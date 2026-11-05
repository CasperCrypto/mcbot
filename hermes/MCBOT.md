# McBot's changes to Hermes Agent

This directory is [Hermes Agent](https://github.com/NousResearch/hermes-agent)
(MIT, © Nous Research; see `LICENSE`) at the upstream commit in
`UPSTREAM.json`, plus the changes below. Each one is marked `McBot:` in the
code and kept as a patch file in `patches/hermes/` (one per file, against that
commit). Keep them few and small, so that `npm run hermes:sync -- <checkout>`
can three-way merge every upstream release into them.

- `npm run hermes:patches -- check` (also part of `npm test`) fails if any patch
  is no longer applied here, so an edit or a sync cannot drop one silently.
- After changing a file here, rewrite the patches with
  `npm run hermes:patches -- make <hermes-agent checkout at UPSTREAM.json's commit>`.
- `npm run hermes:sync` rewrites them against the new upstream and stops if a
  file that had a patch no longer differs from upstream.
- `.github/workflows/hermes-upstream.yml` opens an issue when upstream changes a
  file we patch.

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
| `plugins/platforms/telegram/adapter.py` | With an own Bot API server (`extra.base_url`), `NO_PROXY` is checked against that server's host and Telegram's fallback IPs are not used | Upstream checked only `api.telegram.org` and routed through its fallback-IP transport, so a local Bot API server went through the system proxy and failed |

Not changed on purpose: home initialisation. McBot's runs do not set
`HERMES_MANAGED`, because a managed install stops creating and securing its
home's folders (`hermes_cli/config_home.py`, `initialize_home`).
