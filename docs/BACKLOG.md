# Backlog (2026-11-23)

What is left, in the order to do it. Milestones (M5–M15) are in `docs/PLAN.md`; this list is the
working view of them plus every bug and gap found while using McBot. Move a line to "Done" in the
release notes when it ships.

## Bugs and rough edges

| | What | Where |
|---|---|---|
| ● fixed in 0.4.4 | Stop did nothing while a run was starting, while Hermes was mid-step (long answer, tool, approval), for a one-shot Hermes that ignores SIGINT, and for a run left "running" after McBot quit | `engine/runner.ts`, `engine/server.ts` |
| ● fixed in 0.4.4 | After Stop, messages queued for that agent sent themselves: Stop now clears them and says how many | `actions.ts` `stopRun` |
| ● fixed in 0.5.0 | A connector's Sign in gives no result in the app: the block says waiting, signed in or why it failed (`GET /api/connectors/login`) | `graph/Inspector.tsx`, `engine/server.ts` |
| ● done | Installed skills can be removed or updated from the Skills view (`hermes skills uninstall`, `update`) | `views/SkillsView.tsx` |
| ● fixed in 0.5.0 | Every agent that had not run said "Not compiled" after a restart, even with its files on disk: the dry-run compile now says Ready / Changed / Not compiled | `graph/GraphView.tsx`, `actions.ts` `diskState` |
| ● fixed in 0.5.0 | The demo found Ollama in setup, then said on Home that it wasn't running | `demo/engine.ts` |
| ● 0.5.0 | Faster start: the window paints Chat without React Flow and the other views (468 kB, was 797 kB; they load right after, while idle), and the engine is asked every 400 ms while it starts instead of every 5 s | `App.tsx` |
| ● 0.5.0 | An empty chat offers three starter questions from what the agent is for | `chat/starters.ts` |
| ● 0.5.0 | "McBot Studio x.y.z is out": the installed app asks GitHub's latest release (at start, then every 6 h) and offers Download | `engine/updates.ts`, Settings → About |
| ○ | Seeding the 44 built-in skills after a compile shows no progress | `engine/skills.ts` |
| ● done | The inspector uses the thicker panel material (`--mat-panel`) | `styles/glass.css` |
| ● done | ⌘1–9 follow the rail order (⌘9 is Files), in the shortcut list and ⌘K hints | `shell/Palette.tsx` |
| ● fixed in 0.5.1 | The browser demo lists all 141 library skills (generated: `npm run engine:library`) | `demo/engine.ts` |
| ● 0.5.1 | 19 starting agents (was 6) and 8 starter teams (was 4), each with fitting Hermes library skills installed after the first compile; the Skills view names Hermes' 44 built-in skills | `shell/agentSuggestions.ts`, `graph/teams.ts` |
| ● 0.6.0 | Ask McBot: describe the team, review the proposed harness, add it with one Undo (the board's own model plans it, else a quick plan) | `shell/BuilderSheet.tsx`, `engine/builder.ts`, `src/harness/plan.ts` |
| ● 0.6.0 | Layers view: each agent's harness as Surfaces, Loop, Context, Model, Tools, Plugins, Guardrails; steps per message (`agent.max_turns`) | `graph/LayersView.tsx`, `graph/layers.ts` |
| ● fixed in 0.6.1 | The Browser view showed the web engine's own error page when a page didn't load (Edge's on Windows): McBot's own "Can't reach" / "You're offline" screen now | `workbench/BrowserView.tsx`, `engine/web.ts` |
| ● fixed in 0.6.2 | "The engine didn't start" gave no reason and pointed at a log people couldn't find: the screen now names the cause, shows the log's end, and has Copy details and Restart engine | `src-tauri/src/lib.rs` `engine_status`, `lib/engineHealth.ts` |
| ● fixed in 0.6.3 | Windows: the engine stopped with EBUSY when an unfinished Hermes copy in the data folder was locked; it now steps around it | `engine/bundle.ts` |
| ● fixed in 0.6.4 | A notice under the island vanished when the pointer reached it (the opened island had no notices): it now lists recent notices and the doctor's findings, each with its action | `shell/Island.tsx` |
| ● fixed in 0.6.4 | The inspector cut off its fields when a model id was long (the grid column sized to it) | `styles/graph.css` `.inspector-body` |
| ● fixed in 0.6.4 | Sticky notes on the board could not be moved (the text filled them, and new ones landed under blocks): a grip on top, and new notes go to free space | `notes/StickyNote.tsx`, `graph/place.ts` `noteSpot` |
| ● fixed in 0.6.4 | The dock ran off the board beside the inspector; it now shrinks to fit | `graph/GraphView.tsx` |
| ● 0.7.0 | Light, dark or the system's appearance and macOS's eight accent colours (Settings → Appearance, ⌘K); every literal colour in the style sheets goes through tokens, and `styles/tokens.test.ts` keeps it that way | `lib/appearance.ts`, `styles/tokens.css` |
| ● 0.7.0 | GitHub in the tool catalog (GitHub's hosted MCP server, token in the header); "Suggested for <agent>" skills; the doctor asks for a tool's missing key | `graph/catalog.ts`, `lib/suggestSkills.ts`, `graph/doctor.ts` |
| ● fixed in 0.7.0 | After saving a key, the doctor (title bar, island) and Home kept saying it was missing until a reload | `lib/engine.ts` `onKeysChanged` |
| ● fixed in 0.7.0 | Cost: the price notice had no padding; the daily chart skipped empty days and crowded its bars to the left; agents showed by profile id | `views/CostView.tsx`, `lib/series.ts` |
| ● fixed in 0.7.0 | A long model id pushed an agent block's model and cost out of its card; the board showed through the inspector; on narrow windows the inspector covered the Board / Layers / Hermes switch | `styles/graph.css`, `styles/tokens.css` |
| ● fixed in 0.7.0 | Skill names read "Mcp", "Mlops", "Antigravity cli"; Runs showed raw tool names; chat apps listed raw variable names; Ask McBot's request box had no field style | `lib/names.ts`, `views/RunsView.tsx`, `lib/chatApps.ts` |
| ○ | Hermes' 14 personalities (`display.personality`) apply to chat apps and the terminal but not to runs McBot starts (the runs API takes `instructions` per request): expose them once runs can carry one | `hermes_cli/personality.py`, `gateway/platforms/api_server_runs.py:498` |
| ○ | 30 brands have no logo (Slack, Canva, OpenAI, Microsoft, AWS, Amplitude, Twilio…): add SVGs to `design/logos/` | `design/logos/README.md` |
| ○ | Asana's connector is left out (its OAuth client comes from `${ASANA_CLIENT_ID}`) | `scripts/hermes-connectors.ts` |
| ○ | A daily budget stops runs McBot starts, not Hermes' own schedules or task-board runs | `engine/cost.ts` |

## Next to build (in order)

1. **Workflows (M10).** Trigger (schedule, webhook, chat message, new file) → steps (agents) →
   condition → approval → action. The board draws them; Hermes runs them (cron, kanban hand-offs,
   approvals). First workflow to ship: "write a post, make its image, wait for my OK, publish".
2. **Studio (M10).** A gallery of what agents made (images, videos, posts, files), with
   "approve and post" through a connector or chat app.
3. **Hermes plugins (M6).** Security warnings, disk clean-up, Google Meet notes, Teams meeting
   notes: a switch per agent. Needs a merge rule for `plugins.enabled`, which `hermes plugins
   enable` writes too, so a compile never turns off a plugin someone enabled in Hermes.
4. **Connector status (M6).** Signed in or not, per agent, and the tools each connector gives.
5. **Keychain (M6).** API keys in the macOS Keychain / Windows Credential Manager instead of
   `secrets.json`.
6. **Context meter (M6).** How full each agent's context is, with a warning before Hermes compacts.
7. **Ask McBot as a Builder (M9).** "Add a researcher that can search our docs" proposes a board
   change you review and accept, with Undo.
8. **Coding agents over ACP (M9).** Claude Code, Codex or Gemini CLI as agents on the board, on the
   plan the person already pays for.
9. **Agent diffs and resizable panes (M8).** Read an agent's change in the editor; arrange panes.
10. **Watch the agent's browser and take over (M8).**
11. **Always on (M11).** Gateway in the background with the window closed, launch at login,
    auto-update, signing so macOS and Windows stop warning.
12. **Goals and auto-continue (M7).** A goal on a lead agent that keeps splitting work until done;
    delegation drawn in the run graph.
13. **Team server (M12b).** Boards shared beyond the local network; roles and an audit log.
14. **Packs (M13).** Starter teams as installable packs ("Social media team", "Dev team",
    "Support desk"), and import from other agent tools.
15. **Phones (M14).** Approve an action and read answers from a phone.
16. **Polish (M15).** ● Light theme (0.7.0); layouts, accessibility, languages.

## Ideas parked (from other products, feature references only)

Point at a page element and send it to an agent (Orca), comment on diff lines (Orca), parallel
copies of one task (Orca), branch a conversation (nightly openbot), webhook routines with a signed
URL (nightly openbot), "kinds of action" that always ask: delete, send, post, pay (CopilotKit
OpenBot). Details in `docs/PLAN.md`.
