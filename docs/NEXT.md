# What's missing, and how McBot grows

Written 2026-11-04 after M5; milestone numbers follow the 2026-11-06 plan.
[PLAN.md](PLAN.md) holds the milestone order; this doc explains it: what
Hermes already does that McBot doesn't show yet, what
other agent desktops have, how a company is organised in McBot, how agents work together, and
how other people add modules.

## 1. Is Hermes integrated?

Yes. McBot ships its own copy of Hermes (`hermes/`, upstream v0.23.1) and
runs every agent with it. In the installed app:

1. The download contains the app shell, the engine (one executable) and Hermes.
2. First launch copies Hermes to the app's data folder and downloads its tools
   once (Python, uv, ffmpeg, node, ripgrep). This takes a few minutes and needs internet.
3. Each board compiles into real Hermes files: one profile per agent, with
   `SOUL.md`, `config.yaml`, skills and memory.
4. A run is `hermes -p <agent> chat … --source mcbot`. Its sessions, memory and
   costs land in that profile's `state.db`, and McBot reads them back.

Eight small changes inside Hermes, listed in `hermes/MCBOT.md`, make it know
McBot. One example: `hermes update` says updates come with McBot. Upstream
releases merge in with `npm run engine:sync`.

**What needs no extra setup:** Hermes' default tool sets are already on for
every McBot agent: web search, browser, terminal, files, code, memory, image
generation, text to speech, delegation and schedules. Video and the task board
are opt-in (`hermes_cli/tools_config.py` `_DEFAULT_OFF_TOOLSETS`). Some tools
need a key first; image generation, for example, needs an OpenAI, OpenRouter or
FAL key.

**What does need more:** McBot has no screens yet to turn those tools on or off,
pick their providers, or show what they produced.

## 2. What Hermes has that McBot doesn't show yet

Everything below exists in `hermes/` today. "McBot today" updated 2026-11-05. Before any of it reaches the board,
each config key it needs is verified and recorded in `docs/HERMES.md` (hard rule 2).

| Hermes feature | Where in Hermes | McBot today | Plan |
|---|---|---|---|
| Tool sets per surface (web, browser, terminal, files, vision, image_gen, video_gen, tts, stt, kanban, cron, delegation, computer use) | `hermes_cli/tools_config.py` `CONFIGURABLE_TOOLSETS`; `platform_toolsets` in config | ● Abilities on each agent | done (M6) |
| Image generation: OpenAI, OpenRouter, FAL, xAI, Krea, DeepInfra, Meta | `plugins/image_gen/*`, `image_gen.provider` / `.model` | ● Image maker block; images show in the chat | **M10** Studio gallery |
| Video generation: FAL, OpenRouter, xAI, DeepInfra | `plugins/video_gen/*`, `video_gen.provider` (opt-in tool set) | ● Video maker block; videos show in the chat | **M10** Studio gallery |
| Voice: text to speech, speech to text, voice mode | `tools/tts_*`, `tools/transcription_*` | "Speak" ability on; audio not shown | **M10** |
| Kanban: one durable task board per project, shared by profiles. It has dependencies, review and changes requested, schedules, a dispatcher and "swarm" (parallel workers → verifier → synthesizer) | `hermes_cli/kanban*.py`, `tools/kanban_tools.py`, `hermes kanban --help` | not shown | **M7** Tasks view, the team's work queue |
| Projects: named, multi-folder workspaces | `hermes_cli/projects_*.py` | not used | **M7** maps onto Spaces |
| Delegation: an agent spawns helpers | `tools/delegate_tool*.py` | on, not drawn | **M7** shown in the run graph |
| Cron jobs | `hermes cron`, `tools/cronjob_tools.py` | on, not shown | **M7** schedules, **M10** workflows |
| Webhooks | `hermes webhook` | none | **M10** workflow triggers |
| Chat apps: Slack, Telegram, Discord, WhatsApp, Teams, email, Signal, Matrix and about 20 more, **including Buzz** | `plugins/platforms/*`, `gateway` | ◐ Telegram block (one bot per agent) | **M6** WhatsApp, Slack, Discord, email; conversations in McBot's chat |
| MCP servers | `mcp_servers:` | ● tool nodes | **M6** catalog |
| Skills hub, bundles, curator | `tools/skills_hub*.py`, `optional-skills/` (~200 skills, e.g. `creative/social-media-content-calendar`, `creative/meme-generation`, `media/youtube-content`, `social-media/xurl`) | inline skills only | **M6** skill catalog on agents |
| Approvals before risky actions | `tools/approval*.py`, `hermes approvals` | Hermes asks, McBot can't answer | **M7** approval cards on the board |
| Mixture of Agents, fallback chains | `hermes moa`, `fallback_providers` | ● fallbacks | later |
| Bot-to-bot across machines | `hermes peer` | none | **M12** teams |
| Secrets from Bitwarden / 1Password | `hermes secrets` | own vault | **M6** option next to the keychain |
| Import agents from OpenClaw, Claude Code, Codex | `hermes migrate` / `import` | none | **M13** packs |
| Backups, checkpoints | `hermes backup`, `checkpoints` | none | later |

## 3. What other agent desktops have

Feature references only; no code is copied (hard rule 1).

| Elsewhere | McBot |
|---|---|
| Many agent CLIs (Codex, Claude Code, Grok, Gemini, Cursor, …) through ACP | Hermes only today. **M9**: coding agents through ACP (PLAN.md decision 4) |
| Agent-to-agent messages, replies, files | **M7** handoff edges and kanban tasks |
| Shared channel chats with one task owner, delegation, Stop / Resume / Reassign | **M7** Tasks view (kanban already has assign, reassign, block, review) |
| Message queues with pause / resume | **M7** (Hermes `pause` / `resume`, kanban dispatcher) |
| Embedded browser agents can drive | Hermes' browser tool, on by default; **M8**: the browser pane shows it live, with take-over |
| Computer use | Hermes `computer_use`, on by default (`cua-driver` ships with Hermes' tools) |
| Context monitoring and auto-compaction | Hermes compacts itself; **M6** shows context use on the agent |
| Phone app | **M14** |
| Accounts | **M12**, keypair identity, no password server |

McBot already has things they don't: the editable graph that compiles
into a real runtime, a live shared board with cursors, memory editing, cost per
agent, and one download with the engine inside.

## 4. How a company is organised

```
Workspace          one company, or one person
├── Members        people, each with a role
├── Connections    models, keys, MCP servers, chat apps (shared by every space)
└── Spaces         departments, projects or clients: "Marketing", "Support", "Launch Q1"
    ├── Board      the graph: agents, models, tools, workflows
    ├── Tasks      the space's kanban board
    ├── Files      the space's shared folder
    ├── Studio     everything its agents made: images, video, audio, posts, documents
    └── Members    who can see it, and what they can do there
```

- **Most people need one workspace.** A freelancer has one workspace with one
  space. A company has one workspace with a space per department or project.
  Several workspaces only make sense for an agency running separate clients
  who must never see each other.
- **On disk:** one workspace is one folder and one Hermes home, so agents can
  hand work to each other through kanban. A space is a board plus a kanban
  board (`hermes kanban boards`: "one board per project / workstream") plus a
  folder. Agent ids are unique across the workspace.
- **Agents belong to a space.** A space can borrow an agent from another
  space; it is drawn as a linked node and edited in its home space.
- **Today:** a workspace with boards. M7 adds spaces, M12 adds members.

### Roles

| Role | Can |
|---|---|
| Owner | everything, including members, billing keys and deleting |
| Admin | members and connections |
| Builder | edit boards, compile, run |
| Member | talk to agents, create and comment on tasks, approve when asked |
| Guest | one space, read and comment |

Each role applies per space. A person can be a builder in Marketing and a
member in Support.

## 5. How team members join

The engine listens only on this computer today, so a team shares one
computer's windows. That keeps it safe while there are no accounts. Three
steps:

1. **M12a, host on your network.** The owner turns on Share. McBot shows an
   invite link (24 hours, any number of teammates, replaced with "New link").
   A teammate pastes it into Join in their McBot and gets
   a member key, kept in their keychain. The engine then also accepts that
   computer, but only with a valid key, and still checks `Origin` and `Host`.
   Agents run on the host's computer.
2. **M12b, team server.** One always-on server per company, built on the Buzz
   relay (Apache-2.0, may be merged). Boards, tasks, chat and presence sync
   through it, so people on different networks work together. Identity is a
   keypair, as in Buzz: no password database. Hermes already has a Buzz chat
   adapter (`plugins/platforms/buzz`), so agents can sit in the same channels
   as people.
3. **M14, phones.** Chat, approvals and notifications through the same server.

## 6. How agents work together

There are three layers, each compiled to something Hermes already runs.

1. **Inside one agent: delegation.** An agent spawns short-lived helpers for a
   subtask (`delegate_task`). It is on already; M7 draws the helpers in the
   run graph.
2. **Between agents: tasks.** On the board, an agent → agent edge means "hands
   work to". It compiles into Hermes' kanban settings (keys verified first)
   and a SOUL.md line, so the manager knows its team. Every hand-off becomes a kanban task,
   which gives it an owner, dependencies, comments, attachments, review and
   "changes requested". The Tasks view shows the space's board, live, and
   people create and assign tasks there too. Patterns:
   - **Manager → specialists:** a lead agent breaks a goal into tasks (`kanban decompose`).
   - **Pipeline:** writer → editor → publisher, through task dependencies.
   - **Swarm:** parallel workers → verifier → synthesizer (`kanban swarm`).
3. **Over time: workflows.** In M10, trigger, step, condition and approval nodes
   on the board. Triggers are a schedule (Hermes cron), a webhook (Hermes
   webhook), a chat message (gateway) or a new file. A step is "give this agent
   this task", so workflows are built on kanban rather than a second engine.
   Approvals pause the task until a person says OK.

Every layer stays inside the compile rule: the board writes Hermes files, and
Hermes runs them.

## 7. Images, video, posts and marketing

**Generate**

- Give an agent the Image or Video capability (M6) and a key. An OpenRouter
  key can serve both chat and images.
- Ask it in chat, or give it a task. Hermes saves the result in the agent's
  folder.

**Collect.** The Studio view (M10) is a gallery for each space with images,
video, audio, documents and drafts. Each item shows which agent made it, from
which prompt and run. Open it, download it, or hand it back to an agent
("make it brighter").

**Post**

- Agents post through a connected chat app (M6) or an MCP connector, with an
  approval card before anything goes out.
- X posting already exists as Hermes' `xurl` skill. LinkedIn, Instagram and
  scheduling tools come in as MCP servers.

**A marketing team starter (M10)**

- **Strategist:** plans the calendar, using the `social-media-content-calendar` skill.
- **Writer:** drafts posts and articles.
- **Designer:** makes images and video.
- **Publisher:** posts after approval, on a schedule.

All four are ordinary agents on a board, so you can change any of them.

Image and video providers are Hermes' own plugins. McBot only picks one in
config and passes the key's variable name. Hard rule 4 (two chat-model
providers, no vendor SDKs in McBot) still holds.

## 8. Building on McBot: modules

People add to McBot in four ways. Each is safer and simpler than the one
after it.

| Layer | What it is | How it runs | Safety |
|---|---|---|---|
| **Pack** | a folder with `pack.json` holding agents (soul, skills), tool nodes, workflows, a starter board and an icon | installing adds nodes to a board, and the normal compiler does the rest | content only, no code |
| **Skill** | a Hermes `SKILL.md` (+ files) | Hermes loads it | Hermes' skills guard scans it |
| **Tool** | an MCP server | its own process, configured as a tool node | process boundary; per-agent permissions in M7 |
| **Panel** (later) | a UI view in a sandboxed iframe | talks to the engine only through a typed bridge | no direct file or network access |

- Packs are the main way: a "Support desk", "Marketing team" or "Research
  team" is a pack. Export a board as a pack, share the folder or a Git URL,
  import it elsewhere. A public catalog only comes later, if asked (a
  marketplace is out of scope).
- Inside McBot, every node kind is one module: a zod schema in
  `src/contracts/graph.ts`, a node component, an inspector section, a compile
  contribution with a golden test, and a line in `docs/HERMES.md`. Adding a
  kind (trigger, approval, chat app) touches those five places and nothing
  else. Contracts change additively; a breaking change bumps the version.
- Engine routes are grouped per feature and mirrored in the demo engine, so
  the browser demo keeps working as features land.

## 9. What's needed from the owner

- **Who comes first: a person or a company?** This changes setup questions and defaults.
- **Team order.** Is "share from my computer" (M12a) enough to start, or is
  the team server needed first?
- ~~Logo, brand and agent icons~~: done 2026-11-05, the gray glass burger and
  agents as glass food bots (`src/app/faces/foods.ts`). Keep it clearly our
  own: no golden arches, no red-and-yellow look, no names close to a real
  chain's. That keeps the brand safe from trademark complaints.
- More decisions, for the 2026-11-06 plan (AI plans, signing, the editor, ACP,
  Lightpanda), are in [PLAN.md](PLAN.md#decisions-for-the-owner).
