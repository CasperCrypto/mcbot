# Backlog (2026-11-14)

What is left, in the order to do it. Milestones (M5–M15) are in `docs/PLAN.md`; this list is the
working view of them plus every bug and gap found while using McBot. Move a line to "Done" in the
release notes when it ships.

## Bugs and rough edges

| | What | Where |
|---|---|---|
| ● fixed in 0.4.4 | Stop did nothing while a run was starting, while Hermes was mid-step (long answer, tool, approval), for a one-shot Hermes that ignores SIGINT, and for a run left "running" after McBot quit | `engine/runner.ts`, `engine/server.ts` |
| ● fixed in 0.4.4 | After Stop, messages queued for that agent sent themselves: Stop now clears them and says how many | `actions.ts` `stopRun` |
| ○ | A connector's Sign in gives no result in the app (only the engine log): show signed in / failed on the block | `POST /api/connectors/login` |
| ○ | Installed skills cannot be removed or updated from the Skills view (`hermes skills uninstall`, `update`) | `views/SkillsView.tsx` |
| ○ | Seeding the 44 built-in skills after a compile shows no progress | `engine/skills.ts` |
| ○ | The inspector's glass lets board blocks show through and compete with its text: thicker material | `styles/glass.css` |
| ○ | ⌘9 moved from Files to Skills: check the shortcut list and the ⌘K hints | `shell/Palette.tsx` |
| ○ | The browser demo lists 6 library skills, not all 141 | `demo/engine.ts` |
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
16. **Polish (M15).** Light theme, layouts, accessibility, languages.

## Ideas parked (from other products, feature references only)

Point at a page element and send it to an agent (Orca), comment on diff lines (Orca), parallel
copies of one task (Orca), branch a conversation (nightly openbot), webhook routines with a signed
URL (nightly openbot), "kinds of action" that always ask: delete, send, post, pay (CopilotKit
OpenBot). Details in `docs/PLAN.md`.
