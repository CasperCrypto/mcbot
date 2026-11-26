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

What the files above can't do on their own. One script switches on everything a script can, with your
own GitHub sign-in (an admin's), and is safe to run again:

```bash
gh auth login
```

```bash
bash scripts/github-security.sh
```

It sets (`--dry-run` lists it without changing anything):

- **Merges:** squash merging only, so every commit on the default branch is one GitHub signs; a merged
  pull request's branch is deleted.
- **Code security:** secret scanning with push protection, Dependabot alerts and security updates, private
  vulnerability reporting (this page's "Report a vulnerability" needs it). CodeQL stays on its advanced
  setup (`codeql.yml`).
- **Actions:** only GitHub's own actions plus `tauri-apps/tauri-action`; workflows get a read-only token
  unless they ask for more; Actions may open pull requests (the engine update); a person approves the
  workflows of every outside contributor's pull request.
- **"Protect main"** (ruleset on the default branch): no deleting it, no force pushes, signed commits, and
  every change through a pull request whose checks passed (`test`, `windows`,
  `analyze (javascript-typescript)`, `analyze (actions)`, all from GitHub Actions, and `dependencies` once the
  dependency graph is on: the script checks, and says where to switch it on if Dependabot alerts didn't). An admin may merge a
  pull request GitHub started no checks for (the engine update's, opened by a workflow; or run CI on its
  branch by hand), but never push around a pull request. With a second maintainer, also require one
  approval and review from Code Owners (`.github/CODEOWNERS`).
- **"Protect release tags"** (`v*`): a published version's tag never moves or disappears. Creating one stays
  open, since publishing a release creates its tag, and `release.yml` builds nothing from a commit that is
  not on the default branch.
- **Pages:** HTTPS only (`site/install.sh` is served from there).

Only you can do these:

1. **Two-factor sign-in** with a passkey or an authenticator app, not SMS
   (https://github.com/settings/security); remove apps and tokens you don't use.
2. **Verify `mcbot.studio`** for your account (https://github.com/settings/pages), so nobody else can
   publish under it.
3. **Pin `tauri-apps/tauri-action` to a commit** in `release.yml` (`uses: tauri-apps/tauri-action@<sha> # v1.x.y`;
   `git ls-remote https://github.com/tauri-apps/tauri-action` lists them), then take it out of
   `NOT_PINNED_YET` in `test/supply-chain.test.ts`.
