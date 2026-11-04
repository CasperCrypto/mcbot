# McBot

**Draw your AI agent harness. Compile it into a real one.**

McBot is a desktop app (macOS and Windows) where a team draws a harness of AI
agents as a graph — agents, the models they think with, the tools they can use —
and that graph **compiles into a real, runnable [Hermes Agent](https://github.com/NousResearch/hermes-agent)
setup on disk**. Then the same graph shows what every agent is doing, what it
remembers, and what it costs — live, in every window on the board.

Chat-only agent tools hide the system: you can't see which cron job runs which
agent, what it remembers, or what it spends. McBot makes the harness the thing
you look at and edit.

![The graph, compiled](docs/screenshots/compiled.png)

## What it does today

- **Graph** — place agent, model and tool nodes, wire them, and press **Compile**.
  Every agent becomes a Hermes profile directory: `SOUL.md`, `config.yaml`,
  `profile.yaml`, `skills/<name>/SKILL.md`. The Compile panel lists every file
  written with its SHA-256 and a diff against what was on disk.
- **Run** — run any agent from the canvas. McBot launches `hermes -p <agent>`,
  streams its steps and paints status onto the nodes: the agent goes blue, the
  tool it is calling lights up.
- **Shared board** — open a second window (⌘N): the same graph, live cursors,
  presence, no save button. Every window is a client of the local engine, so
  the board is shared by construction (v0 listens on this computer only).
- **Agents · Workflows · Memory · Files · Cost · Team** — every agent as a row;
  every run as a step-by-step timeline with inputs, outputs, tokens and
  failures; each agent's own memory (view, edit, delete); its profile on disk;
  spend by agent, model and day from Hermes' own session records; who is on the
  board and what they are editing.

| Workflows | Cost |
|---|---|
| ![Run timeline](docs/screenshots/workflows.png) | ![Cost](docs/screenshots/cost.png) |
| **Second window, live cursor** | **Dark** |
| ![Shared board](docs/screenshots/shared-board.png) | ![Dark mode](docs/screenshots/graph-dark.png) |

## Quick start

Requirements: Node 22.13+, and [Hermes Agent](https://github.com/NousResearch/hermes-agent)
installed so `hermes` is on your PATH (or set `MCBOT_HERMES_BIN`). For the
desktop shell, Rust and the [Tauri 2 prerequisites](https://v2.tauri.app/start/prerequisites/).

```bash
npm install
npm run desktop      # the McBot app (starts the engine + UI for you)
# or, in a browser:
npm run dev          # engine on 127.0.0.1:4317, UI on http://localhost:5173
```

Then: **+ Agent**, **+ Local model** (defaults to Ollama on `:11434/v1` — set
the model id you have pulled), wire the model to the agent, **Compile**, select
the agent and **Run**.

No model at hand? `npm run stub-llm` starts a deterministic OpenAI-compatible
server on `:11500` you can point a model node at.

Your boards, runs and compiled profiles live in `~/McBot` (`MCBOT_WORKSPACE`).
Compiled agents are ordinary Hermes profiles; run them without McBot too:

```bash
HERMES_HOME=~/McBot/hermes hermes -p triage
```

## How the graph maps to Hermes

| On the board | On disk (verified against the Hermes source — see [docs/HERMES.md](docs/HERMES.md)) |
|---|---|
| agent | `profiles/<name>/` — a Hermes profile, run as `hermes -p <name>` |
| agent identity | `SOUL.md` at the profile root; `profile.yaml` |
| skill | `skills/<name>/SKILL.md` with Hermes frontmatter |
| model (primary) | `config.yaml` → `model:` + `providers.mcbot-<name>` |
| model (fallbacks) | `config.yaml` → `fallback_providers:` |
| tool | `config.yaml` → `mcp_servers.<name>` (stdio command or URL) |

Two kinds of model endpoint, both OpenAI-compatible: one **local** (Ollama, LM
Studio, vLLM, llama.cpp) and one **cloud** (any OpenAI-compatible API). McBot
stores the *name* of your API-key variable, never the key.

## Architecture

```
┌──────────── McBot window ────────────┐    ┌──────────── McBot window ────────────┐
│ React · React Flow · Yjs · zustand   │    │          (second window, ⌘N)         │
└───────────────┬──────────────────────┘    └──────────────────┬───────────────────┘
                │  HTTP + WebSocket (loopback)                 │
         ┌──────┴──────────────────────────────────────────────┴──────┐
         │ McBot engine (Node)                                        │
         │  board relay (Yjs) · compiler writer · Hermes runner · data│
         └──────┬───────────────────────────────┬─────────────────────┘
                │ writes                        │ spawns, reads
        ~/McBot/hermes/profiles/<agent>/   hermes -p <agent> chat … --format stream-json
                                           state.db · memories/
```

The three contracts — graph schema, compile output layout, run event shape —
are in [`src/contracts/`](src/contracts) and described in [docs/BUILD.md](docs/BUILD.md).

## Development

```bash
npm test                               # unit, golden byte-level compiler tests, engine integration
MCBOT_HERMES_BIN=$(which hermes) npm test   # + a real Hermes run end to end
npm run typecheck
```

Read [CLAUDE.md](CLAUDE.md) before changing the compiler: it holds the
invariants (never invent a Hermes key; every compiler module is byte-tested).

## Status

v0.1, milestones M0–M4: graph, compiler, shared board, run + observe, memory and
cost. No auth (the engine only listens on loopback and checks origins), no
cloud, no installers yet. Next node kinds: workflow, file/folder, memory, human
gate, schedule.

## Licences

McBot's dependencies are permissively licensed: React, React Flow, Yjs,
y-websocket, y-protocols, lib0, zod, zustand, ws, @noble/hashes (MIT); yaml,
lucide-react (ISC); diff (BSD-3-Clause); Tauri (Apache-2.0 OR MIT). Hermes
Agent is MIT (© Nous Research) and is used as an external program, not vendored.
