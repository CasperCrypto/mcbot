# One app: what goes into McBot

Decision (owner, 2026-11-04): McBot is **one app** that does what Hermes Agent,
OpenBot, n8n, Buzz and a Mac-native UI do today. A person downloads McBot,
opens it, and has all of it. It stays open source and usable by companies.

## What each project brings, and how

Licences checked in each repository on 2026-11-04.

| Project | Licence | What McBot gets from it | How |
|---|---|---|---|
| [Hermes Agent](https://github.com/NousResearch/hermes-agent) | MIT | The agent runtime: memory, skills, tools, MCP, gateway, cron, self-improvement | **Merged.** Forked into this repo under `hermes/` and shipped inside the app with its own Python. Keep its `LICENSE`; mark our changes so upstream updates can still be merged. |
| [Buzz](https://github.com/block/buzz) | Apache-2.0 | Team workspace where people and agents share channels; the relay; the workflow engine (`buzz-workflow`); iOS and Android apps (Flutter) | **Merged.** Its relay becomes McBot's team server; its mobile app becomes McBot for phones. Keep `LICENSE` and notices. |
| n8n | Sustainable Use License | Workflow builder, triggers, schedules, integrations | **Rebuilt, no n8n code.** The licence allows only internal business use and free non-commercial redistribution, so its code cannot ship in an open-source app companies use. Workflows become node kinds on McBot's graph, run by Hermes cron and `buzz-workflow`; integrations come as MCP servers. |
| OpenBot | PolyForm Noncommercial | Multiplayer canvas | **Rebuilt, no OpenBot code** (done in M2). Its licence forbids commercial use. |
| Vorssaint utils | GPL-3.0, trade-dress policy | Mac-native look, Raycast-style launcher | **Our own design, no Vorssaint code** (done: tokens, ⌘K). GPL code would force McBot under GPL; the trade-dress policy forbids copying the look. |

Buying a commercial licence (n8n sells one for embedding) or getting the
authors' permission would change a "rebuilt" row to "merged".

## Shape of the app

```
McBot (one download, macOS / Windows / Linux)
├── window          React UI: canvas, chat, runs, memory, files, cost, workflows
├── engine          compile, runs, local board relay (sidecar, starts with the window)
└── hermes/         the agent runtime, with a bundled Python

Team server (optional, a company runs it once: Docker)
└── Buzz relay      channels for people + agents, workflows, sync, push
                    needs PostgreSQL and Redis, so it cannot live inside the desktop app

McBot for iPhone and Android
└── Buzz mobile     Flutter, connects to the team server
```

One person on one computer needs only the app. A team adds the server once;
everyone's app and phone connect to it.

## Phases

1. **One download.** Hermes forked into `hermes/` (runtime only: no tests,
   website or apps in the bundle), bundled Python, engine as a sidecar,
   first-launch setup (finds Ollama or LM Studio, keeps API keys in the OS
   keychain), GitHub release builds for macOS and Windows. The website's
   download buttons go live.
2. **Workflows.** Trigger (schedule, webhook, message), step and condition
   nodes on the graph; compiled to Hermes cron and workflow definitions;
   an integrations catalog of MCP servers.
3. **Teams and phones.** McBot joins a Buzz relay; boards, chat and runs are
   shared across machines; Buzz mobile ships as McBot for iOS and Android.
4. **Canvas depth.** Sections, notes, step nodes with inline results, run-all
   with history.

## Open decisions

- McBot's own licence: Apache-2.0 (matches Buzz, includes a patent grant) or MIT.
- Code signing: Apple Developer ID and a Windows certificate, or unsigned first.
