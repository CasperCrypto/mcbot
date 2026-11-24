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
