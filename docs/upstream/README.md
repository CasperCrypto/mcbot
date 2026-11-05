# Fixes we offer to Hermes Agent

Changes in `patches/hermes/` that are bugs in Hermes itself, not McBot needs,
go back to [NousResearch/hermes-agent](https://github.com/NousResearch/hermes-agent).
Each one taken upstream is one patch fewer for us to carry through every sync.

| Patch | Upstream PR | Status |
|---|---|---|
| `0001-telegram-own-bot-api-server.patch` (our `plugins/platforms/telegram/adapter.py` change) | not opened yet | ready: applies to upstream `d914e233` (2026-11-04), with a regression test |

## 0001: a bot on an own Bot API server honours NO_PROXY

**Title:** fix(telegram): reach an own Bot API server directly, honouring NO_PROXY

**Body:**

With `platforms.telegram.extra.base_url` set (a local or self-hosted Bot API
server), the adapter still checks `NO_PROXY` against `api.telegram.org` and its
fallback IPs only, and builds `TelegramFallbackTransport`. So a bot on
`http://127.0.0.1:8081/bot` is sent through `HTTPS_PROXY` and fails to connect
(seen as a 405 from a proxy that refuses plain-HTTP requests).

With `base_url` set, its host is the one checked against `NO_PROXY`, and the
fallback-IP transport (a stand-in for `api.telegram.org`) is not built. Without
`base_url` nothing changes.

Tests: `tests/gateway/test_telegram_own_bot_api_server.py`; the first test fails
without this change. `tests/gateway/test_telegram_closewait_limits.py` still passes.

**To open it:** fork NousResearch/hermes-agent, `git am` the patch on a branch
from upstream `main`, push, open the PR with the text above. When upstream merges
it, the next `npm run hermes:sync` reports the Telegram patch as gone from
`patches/hermes/` (upstream took it): delete its row in `hermes/MCBOT.md`.
