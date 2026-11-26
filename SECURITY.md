# Security

McBot Studio runs AI agents on your computer, so its security matters to us. Thank you for helping.

## Reporting a vulnerability

Please report it privately, not in a public issue: on GitHub, open the repository's **Security** tab
and choose **Report a vulnerability** (a private advisory only the maintainers see). Include what you
found, how to reproduce it, and what an attacker could do with it.

We answer within a week, keep you posted while we fix it, and credit you in the release notes unless
you ask us not to. Please give us time to ship a fix before you publish details.

## What is in scope

- **The engine** (`engine/`): it listens on `127.0.0.1` only and checks `Origin` and `Host` on every
  request and WebSocket upgrade. **Share** (off by default) opens port 4318 to the LAN and, for
  "anyone with the link", to the internet through a Cloudflare quick tunnel. Every request there
  needs a member key from an invite link (the link's code is nine random characters, valid 24 hours,
  with wrong guesses rate-limited); only key hashes are stored. Guests ("Can chat") reach only their
  own conversations with the agents the host picked; teammates ("Can edit") can change and run the
  host's agents, so invite only people you trust with that. The port serves the app's static files
  so a link opens in a browser; they hold no data.
- **Keys**: API keys typed into McBot live in `<workspace>/secrets.json` (owner-only) and are written
  only into the marked block of each agent's own `.env` (owner-only). The engine never returns a key's
  value, boards and compiled files carry only variable names, and diagnostics hide token-shaped strings.
- **The compiler and writer** (`src/compile/`, `engine/writer.ts`): McBot writes only the files listed in
  its manifest and refuses to write into a profile folder it did not create.
- **Agent safety rails**: risky commands stop for approval; Stop ends a run within seconds; daily budgets
  stop new runs at the limit.
- **The desktop shell** (`src-tauri/`), the website (`site/`) and the browser demo.

The agent engine, Hermes Agent, is forked in `hermes/` from
[NousResearch/hermes-agent](https://github.com/NousResearch/hermes-agent). Report Hermes issues to us
too; we pass upstream ones on and patch our copy.

## Supported versions

Security fixes go into the newest release. Installers are not code-signed yet (free and open source);
download them only from this repository's Releases page or with `site/install.sh`, which talks only to
github.com.

## How releases are made

McBot never updates itself: the app only says a newer release exists and links to it. So the only way
code reaches your computer is a release you download, and these rules keep a release honest:

- **Only merged code is built.** `release.yml` refuses to build from a commit that is not on the
  default branch, so every line in an installer went through a pull request.
- **Pull requests from forks never get secrets or a write token.** CI runs them with `pull_request`
  and a read-only token; nothing a fork's code does can push, tag or release.
- **Installers are built clean** on GitHub's runners: no caches from other workflows, no third-party
  action between the Rust toolchain and the build, credentials never left on disk.
- **The engine update** (`hermes-sync.yml`) runs the new Hermes release's code with a read-only token;
  a separate job, which runs none of it, opens the pull request, and only for changes inside `hermes/`,
  `patches/hermes/` and `src/contracts/`. A person still reviews and merges it.
- **Dependencies** come only from the npm registry (each with its integrity hash) and crates.io; only the
  packages we chose may run install scripts; Dependabot proposes updates and CI fails a pull request that
  adds a dependency with a known high or critical advisory. First launch downloads Hermes' tools at pinned
  versions, each checked against its SHA256 (`hermes/pm/lock.json`).
- `test/supply-chain.test.ts` checks all of the above on every pull request.

### Check a download

Every release lists each file's SHA256 in `SHA256SUMS.txt` (`site/install.sh` checks it for you), and each
installer carries a signed build provenance that says which workflow and commit built it:

```bash
gh attestation verify "McBot.Studio_0.9.0_aarch64.dmg" --repo CasperCrypto/mcbot
```

## If a secret is ever pushed

Treat it as public the moment it reaches GitHub, even if the commit is deleted a minute later: forks,
clones, pull request refs and public archives keep copies, and rewriting history does not reach them.
**Revoke it and make a new one first**; cleaning the history afterwards is optional. Secret scanning with
push protection (below) stops most keys before they leave your computer.

## Settings for maintainers

What the files above can't do on their own. Check these once, and again when someone gets access:

1. **Account:** two-factor authentication with a passkey or an authenticator app (not SMS); review
   Settings → Applications and personal access tokens, and remove what you don't use.
2. **Default branch ruleset** (Settings → Rules → Rulesets → New branch ruleset, target: default branch):
   restrict deletions, block force pushes, require a pull request before merging, and require the status
   checks `test`, `windows` and `dependencies` (CI) and `analyze (javascript-typescript)` (CodeQL). With a
   second maintainer, also require one approval and review from Code Owners (`.github/CODEOWNERS`). Engine
   update PRs are opened by a workflow, so GitHub starts no checks on them: run CI on their branch by hand
   (Actions → CI → Run workflow).
3. **Tag ruleset** (New tag ruleset, target `v*`): restrict creations, updates and deletions, with only
   repository admins allowed to bypass. A `v*` tag starts the release build.
4. **Actions** (Settings → Actions → General): allow actions by GitHub plus `tauri-apps/tauri-action@*`
   only; require approval for workflows from **all external contributors**; workflow permissions
   **read-only** by default, with "Allow GitHub Actions to create and approve pull requests" on (the engine
   update opens one).
5. **Code security** (Settings → Code security): private vulnerability reporting (this page's "Report a
   vulnerability" needs it), Dependabot alerts and security updates, secret scanning with push protection.
   Leave CodeQL on its advanced setup (`codeql.yml`).
6. **Pages:** verify `mcbot.studio` for your account (Settings → Pages → Verified domains) so nobody else can
   publish under it, and keep Enforce HTTPS on: `site/install.sh` is served from there.
7. **Merges and branches** (Settings → General → Pull Requests): allow **squash merging** only, so each pull
   request lands on the default branch as one commit GitHub signs ("Verified"); then add **Require signed
   commits** to the default branch ruleset. Turn on **Automatically delete head branches**, and delete old
   branches whose pull requests were merged or closed.
8. **Pin `tauri-apps/tauri-action` to a commit** in `release.yml` (`uses: tauri-apps/tauri-action@<sha> # v1.x.y`;
   `git ls-remote https://github.com/tauri-apps/tauri-action` lists them), then take it out of
   `NOT_PINNED_YET` in `test/supply-chain.test.ts`.
