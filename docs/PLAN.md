# McBot plan

**One app where a person or a company builds a team of AI agents, connects
them to models and tools, and works with them together, live.** Hermes Agent
runs the agents; McBot makes them visible, shareable and easy. What code comes
from which project is in [MERGE.md](MERGE.md).

## Pillars

Status: ● working today · ◐ started · ○ planned

### From the owner's list

1. **Harness.** The graph of agents, models and tools that compiles into a real
   Hermes setup. ● nodes, wiring, fallbacks, compile with hashes and diffs.
   ○ step nodes with inline results, sections, notes, run-all.
2. **Agents.** Roles, soul, skills, files, context and memory, managed visually.
   ● soul, skills, memory editor, run state on faces.
   ◐ role presets (setup assistant). ○ per-agent knowledge files, avatars, permissions.
3. **Board.** A team works on one page together and watches the work happen.
   ● live board, cursors, presence, runs lighting up nodes.
   ○ comments, approvals on the board, workflows on the board, sync across machines.
4. **Connections.** Models, APIs, MCP servers and connectors in one place.
   ● local and cloud model nodes, MCP tool nodes.
   ◐ local model detection, key vault (setup assistant).
   ○ provider catalog, MCP catalog, chat apps (Slack, Telegram, Discord,
   WhatsApp, email) through the Hermes gateway.
5. **Copilot and terminal.** ○ "Ask McBot" in ⌘K that edits the board for you;
   a terminal panel (shell or Hermes' own TUI); a coding agent from Buzz's
   `buzz-dev-mcp` and OpenBot v0.1.11's Codex and Claude Code connectors.
6. **Clean, customizable Mac UI.** ● dark design system, rail, ⌘K, graphs everywhere.
   ○ light theme, resizable and pinnable panels, layouts saved per person,
   files as graph or list with tags and search.

### Added: what companies will need

7. **Setup assistant.** First launch: who it is for, the company, the roles,
   the model; ends in a working team you can talk to. ◐ building now.
8. **Workflows and automation.** Triggers (schedule, webhook, message, new
   file), steps, conditions, human approval, run history. Built by us, n8n-style.
9. **Safety and control.** Per-agent permissions (tools, folders, spend),
   approval before risky actions, budgets and alerts, audit log, secrets in the
   OS keychain. Companies need this before they trust agents with real work.
10. **Knowledge.** Company documents agents can search; shared team memory
    next to each agent's own.
11. **Always on.** Agents keep working when the window is closed: the Hermes
    gateway as a background service, a menu bar icon.
12. **Teams and roles.** People, invites, roles (admin, builder, viewer), one
    shared server for a company (Buzz relay).
13. **Phones.** Chat, approvals and notifications on iOS and Android (Buzz mobile).
14. **Starter teams and import.** Support desk, research team, personal
    assistant; bring agents over from OpenClaw, Claude Code or Codex (Hermes
    already has importers).
15. **Shipping.** Installers, signing, auto-update, opt-in crash reports, docs, website.

## Milestones

| | Scope | Done when |
|---|---|---|
| **M5** | Setup assistant ●, key vault ●, local model detection ●, Hermes forked into `hermes/` and run by McBot ●, engine and Hermes inside the app with first-launch preparation ●, unsigned installers from `release.yml` ● (Linux verified here; macOS and Windows need their first CI run) | Someone downloads McBot on a Mac or PC, answers five questions, and talks to a working agent within three minutes, without a terminal |
| **M6** | Capabilities and connections: per-agent tools (web, browser, image, video, voice, terminal, computer use) compiled to Hermes tool sets; image and video providers; skill and MCP catalogs; chat apps through the Hermes gateway; keychain | An agent makes an image, and connecting Slack takes one screen |
| **M7** | Organisation and orchestration: spaces (departments, projects) in a workspace; agent → agent hand-off edges; Tasks view on Hermes kanban (assign, depend, review); schedules; approval cards | A lead agent splits a goal into tasks for three agents, and a person approves the result |
| **M8** | Studio and content: gallery of what agents made per space; marketing starter team; post after approval | A post with an image is drafted, approved and published from McBot |
| **M9** | Workflows: trigger, step, condition and approval nodes on kanban, cron and webhooks; history | A weekly report runs itself and waits for a human's OK before sending |
| **M10** | Teams: invite on your network, then the Buzz team server; members, roles per space, audit | Two people on two computers edit and run one board |
| **M11** | Packs: export and import agents, skills, tools and workflows as a folder; starter packs; import from other agents | A "Support desk" pack installs into a new space and runs |
| **M12** | Copilot and terminal | "Add a researcher that can search our docs" changes the board |
| **M13** | Phones | Approve an agent's action from an iPhone |
| **M14** | Brand, customization and polish: logo, agent icons, light theme, layouts, panels, languages | Each person arranges McBot their way, and it remembers |

Why this order, the gaps against Hermes and OpenBot, the workspace → space →
member model, orchestration and modules: [NEXT.md](NEXT.md).

## Design

Each new surface is designed in the app itself and reviewed in the browser
demo, where changes are visible in minutes: setup assistant, connections hub,
workflow nodes, terminal panel, teams and roles, settings, light theme, menu bar.
