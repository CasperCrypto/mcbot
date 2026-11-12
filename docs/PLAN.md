# McBot plan

**McBot is the command center for your AI team.** You build agents as a graph,
they run on the Hermes engine inside the app, and you work with them in one
clean, Mac-style window: chat, tasks, browser, terminal, code, files and apps.
One download, free and open source, for one person or a whole company.

Hermes runs the agents; McBot makes them visible, connected and easy to steer.
What code comes from which project is in [MERGE.md](MERGE.md); why this order,
in [NEXT.md](NEXT.md). Updated 2026-11-06 from the owner's vision: an
orchestration app and AI command center, with a code editor, a terminal and an
AI browser built in.

Status: ● working today · ◐ started · ○ planned

## Where McBot stands

- ● **Build:** the editable graph of agents, models, tools, makers and chat
  apps compiles into real Hermes files, with hashes and diffs.
- ● **Run and watch:** chat with each agent; runs, memory, files and cost are
  graphs; the island shows who is working; several windows share one board live.
- ● **Engine inside:** Hermes ships in the installers and prepares itself on
  first launch; a setup assistant gets a person to a working team.
- ● **Brand:** the gray glass burger logo, agents as glass food bots, the website.
- ◐ **Ship:** installers build for macOS, Windows and Linux, but v0.1.0 is an
  unpublished draft, and no one has installed it on a real Mac or PC yet.

## Now: fix and finish before new features

These come first, because every later feature depends on people being able to
install McBot, trust it and keep it up to date.

1. **Publish v0.1.0.** Owner: set the draft's Target to the default branch and
   publish it; the website's download buttons then appear.
2. **Install it on a real Mac and PC.** Download, open, setup assistant, engine
   preparation, first answer. Write down every snag and fix it.
3. **A faster, sturdier first launch.** Preparing the engine takes minutes and
   needs internet. ● A run that starts during preparation waits for it instead
   of setting the engine up a second time, and says so; the smoke test measures
   it on macOS, Windows and Linux (here: prepared in 51 s, first answer in 12 s).
   ○ Explain offline errors, start the gateway right after preparing (most of
   the first answer's 12 s), and consider shipping the prepared runtime per platform.
4. **Updates.** The Tauri updater, signed with an update key (the release logs
   say "Signature not found for the updater JSON"), and "Update available" in the app.
5. **Signing (decision 2).** Apple Developer ID with notarization, and a Windows
   signature, remove the one-time "Open Anyway" and "Run anyway" warnings.
6. ● **Engine sync.** `hermes/` is on the v0.23.1 release; every patch and every cited source line re-checked.
7. **Tests on every pull request.** ● `ci.yml` runs the tests, the typecheck
   and both builds on every PR. ● `smoke.yml` runs the built engine, first-launch preparation
   and a real agent run on macOS, Windows and Linux.
8. ● **CI upkeep.** The workflows run on Node 24 actions.
9. ● **Say only what is true.** The website's crew graph shows agents using
   their models and tools, not hand-offs, until M7 brings them.
10. ● **When something breaks.** ⌘K → Report a problem: version, system,
    engine state and the log's last lines, keys hidden, to paste into an issue.
    Opt-in crash reports later (M11).

## The parts, and how they connect

```
McBot window (Tauri)
┌──────┬──────────┬──────────── centre ─────────────┬───────────┐
│ rail │ sidebar  │ Home · Board · Chat · Tasks ·    │ inspector │
│      │ (lists)  │ Code · Browser · Studio · Files  │ or agent  │
│      │          ├──────────── bottom ─────────────┤ chat      │
│      │          │ Terminal · run log               │           │
└──────┴──────────┴──────────────────────────────────┴───────────┘
   │ Rust shell: windows, menu bar, notifications, updater, terminal (PTY)
   │ HTTP + WebSocket on this computer only
McBot engine (Node sidecar)
   compile · runs · board relay · files · keys · media · approvals · tasks
   │ files on disk + processes
Hermes (bundled, our fork)
   agents · memory · skills · tools · browser · kanban · cron · webhooks ·
   gateway (chat apps) · delegation · approvals · ACP · peer
   │
Outside: local and cloud models · MCP apps (Gmail, GitHub, Notion, …) ·
chat apps · websites · the team server · phones
```

Every new part keeps the compile rule: what you set on the board becomes Hermes
files, and Hermes runs them. McBot draws, connects and shows; it does not grow
a second agent runtime.

### 1. Board: the harness ●

The graph of agents, models, tools, makers and chat apps. ● nodes, wiring,
fallbacks, compile with hashes and diffs, live cursors.
○ undo history, multi-select and align, notes and sections, templates,
agent → agent hand-off edges (M7), trigger, step, condition and approval nodes (M10).
● Export a board to a file and import it as a new board (`mcbot.graph/v1`
JSON), the first step toward packs (M13).

### 2. Agents ●

● soul, skills, abilities, memory editor, faces that show run state, keys
that reach each agent. ◐ role presets (setup assistant).
○ per-agent knowledge files, permissions (folders, tools, spend), a context
meter, a model switch that keeps the agent's memory and history.

### 3. Home: the command center ◐ (M7)

The first screen of the day. One glance answers: who is working, what finished,
what needs me, what it cost, what runs next.

- **Inbox:** approvals, questions agents asked, finished work, failures, each
  with one action (approve, answer, open, retry).
- **Live:** every agent with its face and current step; stop or redirect it.
- **Today:** spend, tokens and runs, updating as each run finishes; the next
  scheduled jobs.
- **Ask bar:** "give Triage this", "what did Researcher find?".
- **Everywhere:** macOS notifications and a menu bar icon with the same inbox.

### 4. Tasks and orchestration ◐ (M7)

Agents work as a team through Hermes' kanban, which already has owners,
dependencies, review and "changes requested".

- **Tasks view:** the space's kanban board, live; people create and assign tasks too.
- **Hand-off edges** on the board: manager → specialists, pipelines, swarms.
- **Queue:** give an agent its next task while it works.
- **Delegation** drawn in the run graph; **approval cards** answer Hermes'
  approvals from McBot; **schedules** (Hermes cron) on each agent.

### 5. Workbench: terminal, code and browser ◐ (M8)

Build things in McBot, next to the agents doing the work.

- **Terminal panel:** real shells in the bottom panel (xterm.js, MIT; the PTY in
  the Rust shell with `portable-pty`, MIT, so the Node engine stays one plain
  executable). Open a shell in any agent's workspace, or that agent's own Hermes TUI.
- **Code editor:** tabs and a file tree for any opened folder or agent
  workspace (decision 3). Review what an agent changed as a diff, accept or
  undo it, and send a selection to an agent ("fix this", "explain this").
  Git: show status and diffs; commits stay in the terminal for now. The
  inspector's long fields (soul, skill instructions) use the same editor;
  compiled files open read-only, because the next compile rewrites them.
- **Browser:** a browser pane with two modes.
  - **Watch:** the agent's own browser, live (Hermes drives Chromium over CDP;
    screencast frames into the pane), with "take over" and "hand back".
  - **Browse:** your own tabs in a native webview (Tauri multi-webview), with
    "send this page to an agent" and "do this here".
  - **Engines:** Hermes' local Chromium by default; Lightpanda as an optional
    fast engine the person installs (decision 5); cloud browsers through Hermes.
- **Preview:** open what an agent built (a web app on localhost, a report) in
  the browser pane.

### 6. Ask McBot and coding agents ○ (M9)

- **Ask McBot:** in ⌘K and the Home ask bar, a copilot that edits the board:
  "add a researcher that can search our docs" adds the nodes, wires them and
  shows the diff before it compiles. It also explains compile errors and failed
  runs. Speak instead of typing: Hermes already has speech to text.
- **Coding agents:** Claude Code, Codex and Gemini CLI as agents on the board,
  through ACP (decision 4), working in the code editor's folder.
- **Your own AI plan:** run agents on a ChatGPT or Claude plan the person already
  pays for, instead of an API key (decision 1). Hermes has an optional Codex
  runtime (`hermes codex-runtime`); what it covers is verified first (hard rule 2).

### 7. Connections and apps ◐ (M6)

● local and cloud models, MCP tool nodes, image and video makers, Obsidian,
Telegram, saved keys. ◐ local model detection.
○ the OS keychain for keys; an app catalog of MCP servers (Gmail, Calendar,
Drive, GitHub, Notion, Slack, Linear, Figma) with sign-in in one click; Hermes'
skill catalog (about 200 optional skills); WhatsApp, Slack, Discord and email;
chat-app conversations shown in McBot's chat.

### 8. Data: files, memory, knowledge, Studio ◐

● files of any opened folder as a graph, each agent's memory, cost.
○ **Knowledge:** company documents agents can search, and shared team memory
next to each agent's own. ○ **Studio** (M10): everything agents made (images,
video, audio, documents, drafts) with the run that made it. ○ **Search**
everything from ⌘K: agents, runs, tasks, files, memory.

### 9. Workflows ○ (M10)

Trigger (schedule, webhook, chat message, new file), step ("give this agent
this task"), condition and approval nodes on the board, built on kanban and
Hermes cron, with run history. Posting after approval (social, email, chat).

### 10. Safety and control ◐

● the engine only listens on this computer and checks origins; keys never
leave the engine. ○ per-agent permissions (tools, folders, spend), budgets and
alerts, approvals before risky actions, an audit log, secrets in the keychain or
1Password and Bitwarden (Hermes `secrets`), sandboxed code runs.

### 11. Always on ○ (M11)

Agents keep working when the window is closed: the Hermes gateway as a
background service, launch at login, the menu bar icon, schedules that run
overnight, notifications when something needs you.

### 12. Teams and McBot Cloud ○ (M12)

● Share a board on your network with an invite code (M12a), then the team server
on the Buzz relay (M12b): members, roles per space, audit, presence. McBot Cloud
is the hosted, always-on version and the paid product ([MERGE.md](MERGE.md)).

### 13. Packs and starter teams ○ (M13)

Export and import agents, skills, tools and workflows as a folder. Starter
teams (personal assistant, support desk, research, marketing, dev team), and
import from OpenClaw, Claude Code and Codex (Hermes `migrate`).

### 14. Phones ○ (M14)

Chat, approvals and notifications on iPhone and Android (Buzz mobile, through
the team server).

### 15. Design and polish ◐ (M15)

● dark design system, flat macOS look, rail, ⌘K, graphs everywhere, the logo
and agent faces. ○ panes you resize, pin and rearrange (centre, right and bottom),
tabs in the centre, layouts saved per person, a light theme, keyboard shortcuts
for every action, accessibility, languages.

### 16. Shipping and growth ◐

● installers from `release.yml`, the website with the browser demo.
○ everything in "Now" above; a docs site and changelog; short videos of real
tasks; starter-team templates on the website; a community place (GitHub
Discussions or Discord); an opt-in count of first-run successes, so we know
whether setup works.

## Milestones (build order)

| | Scope | Done when |
|---|---|---|
| **M5** ● | Setup assistant, key vault, local model detection, Hermes inside the app, unsigned installers | Someone downloads McBot, answers five questions and talks to a working agent within three minutes, without a terminal |
| **M6** ◐ | Connections: abilities ●, image and video makers ●, Obsidian ●, keys through each profile's `.env` ●, Telegram ●; keychain ○, app catalog with sign-in ○, skill catalog ○, WhatsApp, Slack, Discord, email ○, chat-app conversations in McBot ○, context meter ○ | Connecting Gmail or Slack takes one screen, and an agent uses it |
| **M7** ◐ | Command center and team work: Home (inbox, live, today, ask bar) ●, notifications and the menu bar icon ●; Tasks view on Hermes kanban ●; hand-off edges ●; schedules ●; queue ○; delegation in the run graph ○; approval cards ○; spaces ○ | A lead agent splits a goal into tasks for three agents, a person approves the result from the inbox, and a scheduled job runs while they watch Home |
| **M8** ◐ | Workbench: terminal panel ●, code editor ● (agent diffs ○), browser: preview window ●, watch the agent's browser and take over ○, resizable panes ○ | An agent builds a small web page in a folder; you read its diff in the editor, run it in the terminal and see it in the browser pane, without leaving McBot |
| **M9** ○ | Ask McBot (board copilot) and coding agents through ACP; running agents on a ChatGPT or Claude plan (decisions 1 and 4) | "Add a researcher that can search our docs" changes the board, and a Claude Code agent fixes a bug in the editor's folder |
| **M10** ○ | Workflows (trigger, step, condition, approval) and Studio (gallery, posting after approval) | A weekly report runs itself and waits for a person's OK before it is sent |
| **M11** ○ | Always on and launch: background gateway, launch at login, auto-update, signing (decision 2), crash reports, docs site | Agents keep their schedules with the window closed, and McBot updates itself |
| **M12** ◐ | Teams: share on your network (M12a), then the Buzz team server (M12b); roles, audit; McBot Cloud | Two people on two computers edit and run one board |
| **M13** ○ | Packs and starter teams; import from other agents | A "Dev team" pack installs into a new space and runs |
| **M14** ○ | Phones | Approve an agent's action from an iPhone |
| **M15** ◐ | Polish: light theme, layouts, shortcuts, accessibility, languages (brand and agent icons ● done) | Each person arranges McBot their way, and it remembers |

"Now" runs before and alongside M6. Hermes upstream syncs happen whenever the
daily watchdog opens an issue.

## Decisions (made by the owner, 2026-11-12)

1. **Your own AI plan: yes.** People can use a ChatGPT or Claude plan they already pay for,
   only through runtimes the vendor or Hermes ships (Codex runtime, the vendor's own CLI as an
   agent), never a vendor SDK inside McBot. Hard rule 4 says so now.
2. **Signing: free only.** Windows: SignPath Foundation's free open-source signing, and the
   Microsoft Store (free for individual developers). Linux: Flathub. macOS: no free way to
   avoid Gatekeeper (Developer ID is $99/year; Homebrew now requires notarization), so the Mac
   download keeps the one-time "Open Anyway" with clear steps until that changes. Phones: an
   installable web app (iPhone and Android, no store, no warning).
3. **Code editor: Monaco** (done).
4. **ACP: yes**, for Claude Code, Codex and Gemini CLI as agents (M9). It is also how a Claude
   or ChatGPT plan runs in McBot (decision 1).
5. **Lightpanda: optional**, installed by the person, off by default (done).
6. **People and companies both come first.** Setup asks which, and the starter teams cover both.
7. **Teams: network sharing first** (done, M12a), then the team server for remote teams (M12b).
8. **Name and domain:** McBot, on the cheapest available McBot domain (the owner buys it).
9. **Hermes is the harness; the board is its live, two-way editor.** McBot exists to see, build
   and manage AI agents and their whole Hermes setup visually. Hermes' own files (config.yaml,
   SOUL.md, skills, schedules, chat apps, memory, plugins) are the master copy; the board draws
   them, edits exactly the keys it changes, keeps the rest, and follows changes made in Hermes
   (by hand, by the CLI or by agents). Layout, notes and drawings stay on the board. Steps:
   (a) reader: a Hermes setup becomes a board (done: "Open my Hermes setup");
   (b) careful writer: compile edits only its own keys and keeps unknown ones (done);
   (c) watcher: changes in Hermes reach the open board live;
   (d) the Library: every ability, skill, chat app, memory and plugin Hermes has, to add;
   then Ask McBot builds through the same path.

## Launch checklist

| | Item | Who |
|---|---|---|
| ○ | v0.2.0 installers, installed on a real Mac and PC | owner tests, Claude fixes |
| ○ | A real model end to end (Ollama, one cloud model) | owner's key, through a secure form |
| ○ | Approval cards: answer Hermes' "may I?" from McBot | Claude |
| ○ | Always on: background engine, launch at login | Claude |
| ○ | Budgets per agent, with alerts | Claude |
| ○ | Auto-update (signed update manifest) | owner makes the key, Claude wires it |
| ○ | Windows: SignPath Foundation signing in release.yml; Microsoft Store listing | owner applies and registers, Claude wires it |
| ○ | Linux: Flathub | Claude prepares, owner submits |
| ○ | Phones: installable web app for chat and approvals | Claude |
| ○ | Your own ChatGPT / Claude plan (decision 1) | Claude |
| ○ | Ask McBot | Claude |
| ○ | Google and Slack sign-in | Claude |
| ○ | Docs, changelog, website on the domain, fresh screenshots, a short video | Claude, owner records the video |
| ○ | Licences and notices check | Claude |

## Design

Each new surface is designed in the app itself and reviewed in the browser
demo, where changes are visible in minutes: Home, the Tasks view, the
workbench panes (terminal, editor, browser), the app catalog, workflow nodes,
teams and roles, settings, the light theme and the menu bar.
