# McBot Studio: where it stands and where it goes (2026-11-24)

The plan behind the next releases: what McBot has, what Hermes offers that the board does not show
yet, what others do, and what we build next and why. Milestone details stay in [PLAN.md](PLAN.md);
reasons for the order in [NEXT.md](NEXT.md).

## The idea in one paragraph

**AI agents that stay yours.** People draw a team of agents as a graph; the graph is the harness and
compiles into a real Hermes Agent setup on their own computer. Any model works, local or cloud, and
switching is a setting, so nobody is stuck when a better model ships or an account is lost. The same
graph shows what every agent does, remembers and costs. Instead of tuning agents with long prompts,
people change the drawing: *graph engineering*. McBot is Hermes with design thinking on top.

## What McBot has today (0.7)

| Area | What works | Status |
|---|---|---|
| Harness | Board (agents, models with backups, tools, makers, chat apps, hand-offs), compile to real files, read back from Hermes, live two-way sync, Layers view, Hermes view, Live files, doctor, undo | ● |
| Harness over time | History: a version per compile that changes the harness, changes in words, runs/success/cost/time per version, compare two, restore; harness as text for any AI (⌘K) | ● new |
| Agents | One page per agent (personality, models, tools, skills, abilities, limits), New agent with 19 starting cards, 8 ready-made teams, Ask McBot builds a team from words | ● |
| Models | Any OpenAI-compatible model: Ollama, LM Studio, llama.cpp, vLLM, Jan locally; OpenRouter, OpenAI, Anthropic, Gemini, Groq, DeepSeek, Mistral, Together, OpenCode Zen in the cloud; model marks and readable names; thinking level per agent | ● |
| Tools | 60+ tools: Hermes' vetted connectors, GitHub, keyless web search, any MCP server; "only these tools" per server to cut tokens | ● |
| Chat apps | 25: Telegram, Slack, Discord, WhatsApp, Signal, Teams, iMessage, email, SMS and more | ● |
| Skills | 44 built-in, 141 in the library, suggested per agent, any GitHub skill, plugins on/off | ● |
| Work | Chat with queue and rich answers (tables, charts, drawings), tasks board, schedules, approvals, Stop, daily budgets, cost per agent/model/day, memory you can edit | ● |
| Workbench | Code editor, terminal, browser view, files as a graph | ◐ (agent-driven browser is next) |
| Team | Share a board on your network, live cursors, team chat with @agent, no accounts | ● |
| Mac and PC | Home dashboard, ⌘K, ⌘⇧Space from anywhere, island, menu bar, notifications, dark design, accent colours | ● |
| Shipping | One download (engine inside), macOS/Windows/Linux, weekly engine updates as PRs, update notice | ◐ (signing, auto-update) |

## Hermes features and the board

McBot must let people use everything Hermes can do, in pictures. Every row that compiles is verified
in Hermes' source and recorded in [HERMES.md](HERMES.md) (hard rule 2).

| Hermes feature | On the board | Next |
|---|---|---|
| Profiles, SOUL.md, model chain and fallback | ● agent page, wires | |
| Toolsets (web, browser, terminal, files, code, vision, voice, memory, todo, delegation, task board, cron, computer use, …) | ● abilities | per-ability settings where Hermes has them |
| MCP servers, OAuth sign-in, tool include/exclude | ● tool blocks, only-these-tools | tool lists fetched from the server to tick |
| Skills (bundled, library, learned), plugins | ● Skills view, agent page | skill authoring with AI |
| Reasoning effort | ● Thinking per agent | per-model overrides |
| Steps per message (`agent.max_turns`) | ● | run time budget (`agent.run_budget_seconds`) |
| Approvals, Stop | ● | approval presets ("always ask before sending, paying, deleting") |
| Delegation / subagents (`delegation.*`) | ◐ hand-offs | a "helpers think with" wire (cheap model for subagents) |
| Mixture of agents (`moa.presets`) | ○ | advisor models wired into an agent, drawn as a fan-in |
| Loops and goals (`/loop`, `/goal`, `goals.max_turns`) | ○ | loop and goal blocks in Layers |
| Context compression, prompt caching | ○ | compaction threshold and cache settings on the agent page |
| Checkpoints (file rollback) | ○ | a rollback timeline in Runs |
| Voice (TTS, STT, wake word) | ◐ ability only | voice settings and a talk button in chat |
| Gateway platforms | ● 25 chat apps | |
| ACP (coding CLIs as agents) | ○ | M9: Claude Code, Codex, Gemini CLI as agents |
| Trajectories (`run_agent.py --save_trajectories`, `batch_runner.py`, `trajectory_compressor.py`) | ○ | the Model lab (below) |

## Who else is in this space

| Product | What it is | What it does well | Where McBot is different |
|---|---|---|---|
| OpenAI Dots ([OpenAI](https://openai.com/index/introducing-dots/), Sept 2026) | Always-on agents in ChatGPT, each with a cloud computer and browser, GPT-6 Astra, 4,000 apps, Pro plan and up | Always on, huge app catalogue, polished | OpenAI's models and cloud only, $100+/month; McBot is any model, your computer, free, and you can see and change the harness |
| ChatGPT, Claude, Grok apps | Chat assistants with tools and agents | Easy, strong models | One company's models; history and memory stay with them; nothing to move when you switch |
| OpenBot ([listings](https://www.producthunt.com/products/openbot)) | Local-first desktop for persistent agents that run coding CLIs; PolyForm Noncommercial | Agent-to-agent messages, files, embedded browser | Not open source (noncommercial licence); no visible harness, no cost per agent, no approvals by default |
| MonoCode ([GitHub](https://github.com/hardbeat920/monocode), MIT) | A GUI for coding agents: tabs are sessions, split panes, worktrees | Clean, fast, side-by-side sessions | Coding only; McBot is a whole team for any work, with a harness, memory, cost and chat apps |
| Agent frameworks (LangGraph, CrewAI) | Code libraries | Flexible | Need Python; McBot is no-code, and its harness is a real Hermes setup |
| Workflow builders (n8n, Zapier) | Trigger → step automations | Integrations | Steps, not agents; n8n's licence is not open source |

Ideas we take, as features only (never code under a noncommercial or copyleft licence, hard rule 1):
always-on agents with their own computer (Dots; McBot: M11 background gateway plus computer use),
side-by-side sessions in split panes (MonoCode; McBot: chat in tabs and splits, M15), agent-to-agent
messages and file hand-off (OpenBot; McBot: M7).

## The harness is the product: graph engineering

People think in boxes and arrows; agents should be built that way too. The board already is the
harness. What makes it great:

1. **See it** ●: every part of an agent on one board, layered from outside in (Layers), and the
   real files beside it (Live files).
2. **Change it by drawing** ●: wires are model chains, tools, chat apps and hand-offs; the agent page
   holds the rest. No prompt engineering needed to change behaviour.
3. **Know which version is better** ● new: History keeps every version with its runs; compare two on
   success, cost, time and tokens per run.
4. **Next: test a harness before you ship it** (M9): an *eval set* per board (questions with what a good
   answer contains); "Run the evals" on two versions and see which answers better and cheaper. Then
   *A/B live*: send a share of real messages to a candidate version.
5. **Next: AI that reads and edits the graph** (M9): the harness as text ships now (⌘K "Copy the harness
   as text"); next, Ask McBot gets the current harness and proposes a change as a reviewable diff
   ("make the researcher cheaper" → a cheaper model, fewer tools, a budget), and agents get an MCP tool
   to read the board.
6. **Next: loops, goals and advisors as shapes** (M9/M10): Hermes' `/loop`, `/goal` and mixture-of-agents
   drawn on the board, so a loop is a visible cycle and advisors fan into an agent.

## Make McBot yours: customise it by talking to it

Companies need their own views, data and tools inside the app. The plan, in order:

1. **Views you make with AI** (M10): ask "make a view of this week's tickets by customer" and an agent
   writes a single-file page into `<workspace>/views/`; McBot shows it as a tab, sandboxed (no network,
   no keys), with a read-only data bridge to runs, cost, tasks and files. Charts and animations come
   free with it. Views share like any file and go into Packs (M13).
2. **Web apps as tabs** (M8): pin any site (Gmail, Notion, a dashboard) as a tab in the Browser view;
   the agent can drive it while you watch, and you can take over.
3. **Your computer, in reach** (M8/M11): files, code, terminal and browser are in the app; desktop apps
   are reached through Hermes' computer use (McBot cannot embed another app's window); `mcbot://` links
   and macOS Shortcuts actions start agents from anywhere.
4. **Email, databases, social media**: email already works as a chat app (agents answer mail); Postgres
   and data warehouses through Hermes' connectors (Neon, Supabase, Prisma Postgres, MotherDuck) or any MCP
   server; social through MCP servers and Hermes' X search. A "Connect" page by category comes with M6.

## Spend less on every message

- **Only the tools an agent needs** ● new: each MCP server's tool list can be cut to what the agent uses
  (`mcp_servers.<name>.tools.include`); every message then carries fewer tool definitions.
- **Code instead of tool calls**: Cloudflare's [Code Mode](https://blog.cloudflare.com/code-mode-mcp/) and
  Anthropic's [code execution with MCP](https://www.anthropic.com/engineering/code-execution-with-mcp) have
  the model write code against tools instead of loading every definition: Cloudflare reports its whole API
  in about 1,000 tokens instead of 1.17 million. Hermes already has this for its own tools (the "Code"
  ability: `execute_code`, programmatic tool calling), not for MCP tools. Plan: a small, marked patch to
  Hermes (and a PR upstream) that lets `execute_code` call MCP tools, then a per-agent "Code mode for tools"
  switch.
- **Cheaper helpers** (next): subagents on a cheap model (`delegation.model`), a cheap backup first, local
  models where they are good enough, Hermes' prompt caching on.
- **Know it**: cost per agent, model, day and harness version, with budgets that stop at the limit ●.

## Open models and your own hardware

McBot is for open models and owned hardware first: they run free, private and forever.

1. **Find and run** ●: local servers are found at start; any model with an OpenAI-compatible API works.
2. **Get models in the app** (next): a model shelf that pulls Ollama models with a progress bar and says
   which fit this computer's memory.
3. **The Model lab: train your own** (M16, new): pick good runs from History and chat (thumbs up) →
   McBot writes a dataset (Hermes' trajectory format) → fine-tune on this computer with MLX-LM on Apple
   silicon or Unsloth on NVIDIA (or a rented GPU) → serve it with Ollama → it appears as a model block,
   and History shows whether it beats the cloud model on your own work.

## Open-source projects worth bringing in (licence checked)

| Project | Licence | For |
|---|---|---|
| [LobeHub icons](https://github.com/lobehub/lobe-icons) | MIT | model marks ● (in 0.7) |
| [MLX-LM](https://github.com/ml-explore/mlx-lm) | MIT | fine-tuning on Apple silicon (Model lab) |
| [Unsloth](https://github.com/unslothai/unsloth) | Apache-2.0 | fine-tuning on NVIDIA (Model lab) |
| [llama.cpp](https://github.com/ggml-org/llama.cpp), [Ollama](https://github.com/ollama/ollama) | MIT | serving trained models; the model shelf |
| [Cloudflare Agents SDK](https://github.com/cloudflare/agents) | MIT | reference for Code Mode with MCP |
| [MCP servers](https://github.com/modelcontextprotocol/servers) | MIT | databases, files, fetch as tools |
| [Activepieces](https://github.com/activepieces/activepieces) community edition | MIT (check per folder) | to evaluate: hundreds of app integrations exposed over MCP |

Not to copy (features only, if at all): OpenBot (PolyForm Noncommercial), n8n (Sustainable Use),
tldraw (own licence), Open WebUI (branding clause). See [MERGE.md](MERGE.md).

## Security and the repository

Done in this round: a scan of the whole git history found no real keys (one fake test key); SECURITY.md
with private reporting; Dependabot (npm, cargo, Actions; Tauri pinned to 2.x); CodeQL on every PR and
weekly; issue forms and a PR template.

**Keep this repository rather than start a new one.** Its pull requests are part of an open-source
project's record and build trust; nothing secret is in them; a new repository would lose stars, links,
releases, the update check (`api.github.com/repos/CasperCrypto/mcbot`) and the website's download
links. If a clean public face is still wanted: make a new public repository from a single squashed
commit, archive this one as private, and change those links in one release.

For the owner, in GitHub's settings (McBot cannot change these):
1. Rename the default branch to `main` (GitHub redirects old links; the workflows already list `main`).
2. Protect it: pull requests only, CI and CodeQL required, no force-push.
3. Security: private vulnerability reporting, secret scanning with push protection, Dependabot alerts.
4. Actions: allow GitHub Actions to create pull requests (the weekly engine update needs it).
5. Signing when there is budget: Apple Developer ID and a Windows code-signing certificate, then the
   signed Tauri updater (M11).

## Order of work

| When | What |
|---|---|
| 0.7 (this release) | Home dashboard, one page per agent, model marks, thinking level, only-these-tools, History with compare, harness as text, the new website and app icon, security files |
| Next (0.8) | Ask McBot edits the existing harness as a diff; eval sets; helper and advisor wires; model shelf; web apps as tabs; chat split panes |
| Then (0.9) | Views made with AI; Code mode for MCP tools (Hermes patch); loops and goals on the board; always-on background gateway, launch at login; signing and auto-update |
| Later | Model lab (train your own); Packs; phones (approve from your phone); teams across networks |
