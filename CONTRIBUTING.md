# Contributing to McBot Studio

Thanks for helping. Bug reports, ideas, docs and code are all welcome.

## Report a bug or ask for something

- **A bug:** open an issue with the bug form. ⌘K → "Report a problem" in the app copies what we need (with your
  keys and home folder hidden).
- **An idea:** open an issue with the idea form. Say what you were trying to do; the why helps more than the how.
- **A security issue:** please don't open a public issue. Report it privately, as [SECURITY.md](SECURITY.md)
  explains.

## Set up

Requirements: Node 22.13+ and bash (macOS, Linux, or Git Bash on Windows). For the desktop app, Rust and the
[Tauri 2 prerequisites](https://v2.tauri.app/start/prerequisites/).

```bash
npm install
npm run engine:setup   # once: the agent engine's Python and tools (a few minutes)
npm run desktop        # the app; or `npm run dev` for engine + UI in a browser
npm run stub-llm       # a deterministic model on :11500, for working without a real one
```

## Before you open a pull request

```bash
npm test               # all tests, including byte-level compiler tests
npm run typecheck
npm run build          # and `npm run build:demo` if you touched the UI
```

- Read [CLAUDE.md](CLAUDE.md) first. It holds the project's invariants. The short version:
  - **Never invent an engine config key, path or CLI flag.** Confirm it in Hermes' source (`hermes/`) and
    record it with its source line in [docs/HERMES.md](docs/HERMES.md).
  - **Every compiler module is byte-tested.** Golden files live in `test/fixtures/*.expected/`; regenerate them
    only after reviewing the diff (`npx tsx scripts/update-golden.ts`).
  - **MIT-compatible code only.** MIT, Apache-2.0 and BSD code may come in with its licence kept; never copy code
    under a noncommercial, source-available or copyleft licence.
  - **Never write secrets.** Boards and compiled files carry only the *name* of a key.
- UI: dark, quiet, Apple-native. Colours, radii and motion come from tokens (`src/app/styles/tokens.css`); a
  test fails on a literal colour. Short labels, details in tooltips.
- Keep pull requests focused, and fill in the template: what a person using McBot will notice, and the checks.
- Changes inside `hermes/` stay small and marked, each one also a patch in `patches/hermes/`.

## Where things are

| Path | What |
|---|---|
| `src/compile/` | the compiler: board → Hermes files (pure, deterministic) |
| `src/contracts/` | the three contracts: graph schema, compile layout, run events |
| `src/app/` | the app (React, React Flow, Yjs, zustand) |
| `engine/` | the local engine: board relay, writer, runner, sharing |
| `src-tauri/` | the desktop shell (Rust, Tauri 2) |
| `hermes/` | the agent engine, Hermes Agent (MIT), forked |
| `site/` | the website, static |
| `docs/` | plan, strategy, engine notes, release notes |

By contributing, you agree that your contributions are licensed under the project's [MIT licence](LICENSE).
