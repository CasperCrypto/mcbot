# One app: what goes into McBot

Decision (owner, 2026-11-04): McBot is **one app** that does what an agent
runtime, an agent desktop, a workflow builder, a team chat and a Mac-native UI do today. A person downloads McBot,
opens it, and has all of it. McBot is free and open source under the **MIT
licence**, and anyone, companies included, may use it for any purpose.

That last part decides what code can come in: a licence that limits commercial
use binds everyone who uses McBot, even though McBot itself is free, and MIT
cannot override it.

## How McBot earns

Decision (owner, 2026-11-05): **the app is the funnel, not the product.** McBot
is MIT and public, and that grant cannot be withdrawn: anyone may ship our UI.
So the free app is the distribution, and the revenue comes from what one
download cannot do on its own:

- **McBot Cloud**, the hosted, always-on version: agents that keep working when
  the laptop is closed, the shared team board (M10), phones (M13), backups. The
  same server is free to run yourself; people pay for not having to.
- **For companies**: team accounts, roles and audit (M10), support, and help
  setting teams up.

So the team server and its hosted version are the paid product, built on the
free, open app. Code from projects whose licences forbid hosting it for others
(n8n's Sustainable Use License, noncommercial licences) stays out (hard rule 1).

## What each project brings, and how

Licences checked in each repository on 2026-11-04.

| Project | Licence | What McBot gets from it | How |
|---|---|---|---|
| [Hermes Agent](https://github.com/NousResearch/hermes-agent) | MIT | The agent runtime: memory, skills, tools, MCP, gateway, cron, self-improvement | **Merged (2026-11-04).** `hermes/` is upstream `1e208b2` plus McBot's changes (`hermes/MCBOT.md`), and McBot runs it by default. `npm run engine:sync -- <checkout>` merges later releases. Shipping it inside the installers with its own Python is the rest of M5. |
| [Buzz](https://github.com/block/buzz) | Apache-2.0 | Team workspace where people and agents share channels; the relay; the workflow engine (`buzz-workflow`); iOS and Android apps (Flutter) | **Merged.** Its relay becomes McBot's team server; its mobile app becomes McBot for phones. Keep `LICENSE` and notices. |
| [n8n](https://github.com/n8n-io/n8n) | Sustainable Use License (Apache-2.0 with Commons Clause since its first release) | Workflow builder, triggers, schedules, integrations | **Rebuilt, no n8n code.** The licence allows only internal business use and free non-commercial redistribution, so its code cannot ship in an open-source app companies use. Workflows become node kinds on McBot's graph, run by Hermes cron and `buzz-workflow`; integrations come as MCP servers. |
| [Vorssaint utils](https://github.com/vorssaint/vorssaint-utils) | GPL-3.0-or-later (first releases PolyForm Noncommercial); trademark policy covers name, icon and trade dress | Mac-native look, Raycast-style launcher | **Our own design, no Vorssaint code** (done: tokens, ⌘K). GPL code would turn all of McBot into GPL instead of MIT. |

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

The order of work is in [PLAN.md](PLAN.md): M5 (one download) merges Hermes;
M8 (copilot and terminal) builds its coding-agent connectors and takes Buzz's dev
tools; M9 and M10 (teams, phones) take the Buzz relay and Buzz mobile.

## Open decisions

- ~~Code signing~~: decided 2026-11-04, unsigned while McBot is free (macOS ad-hoc,
  Windows unsigned; the website explains "Open Anyway").
- Signing in with a ChatGPT or Claude plan (Codex and Claude Code connections)
  breaks hard rule 4 (two OpenAI-compatible providers, no
  per-vendor SDKs). Taking that code means changing the rule.
