/**
 * A tiny Telegram Bot API stand-in for offline tests of Hermes' Telegram
 * adapter (pointed here with `platforms.telegram.extra.base_url`, i.e. a
 * chat-app node's "Bot API server"). Requests arrive as `/bot<token>/<method>`
 * with a form or JSON body. Updates are queued with `say()` and handed out by
 * long-polling `getUpdates`; every message the bot sends or edits is recorded.
 */
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";

export interface SentMessage {
  method: string;
  chatId: string;
  text: string;
}

export interface StubTelegram {
  /** Base URL to configure: `http://127.0.0.1:<port>/bot`. */
  url: string;
  /** Methods called, in order (with the token they used). */
  calls: { method: string; token: string }[];
  sent: SentMessage[];
  /** Queue a private text message from user `fromId`. */
  say(fromId: number, text: string): void;
  close(): Promise<void>;
}

const BOT = { id: 4242, is_bot: true, first_name: "McBot test", username: "mcbot_test_bot", can_join_groups: true, can_read_all_group_messages: false, supports_inline_queries: false };

function readBody(req: IncomingMessage): Promise<Record<string, string>> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      const type = String(req.headers["content-type"] ?? "");
      try {
        if (type.includes("json")) return resolve(JSON.parse(raw || "{}") as Record<string, string>);
        if (type.includes("multipart")) {
          const out: Record<string, string> = {};
          for (const m of raw.matchAll(/name="([^"]+)"\r\n(?:[^\r\n]*\r\n)*\r\n([\s\S]*?)\r\n--/g)) out[m[1]!] = m[2]!;
          return resolve(out);
        }
        resolve(Object.fromEntries(new URLSearchParams(raw)));
      } catch {
        resolve({});
      }
    });
  });
}

export async function startStubTelegram(): Promise<StubTelegram> {
  const calls: StubTelegram["calls"] = [];
  const sent: SentMessage[] = [];
  const updates: unknown[] = [];
  let nextUpdate = 1;
  let nextMessage = 100;
  const waiters = new Set<() => void>();

  const message = (chatId: string, text: string) => ({ message_id: nextMessage++, date: Math.floor(Date.now() / 1000), chat: { id: Number(chatId), type: "private", first_name: "Tester" }, from: BOT, text });

  const server: Server = createServer(async (req, res) => {
    const m = /^\/bot([^/]+)\/([A-Za-z]+)$/.exec((req.url ?? "").split("?")[0] ?? "");
    const body = await readBody(req);
    const reply = (result: unknown) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true, result }));
    };
    if (!m) {
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: false, error_code: 404, description: "Not Found" }));
      return;
    }
    const [, token, method] = m as unknown as [string, string, string];
    calls.push({ method, token });
    switch (method) {
      case "getMe":
        return reply(BOT);
      case "getUpdates": {
        const offset = Number(body.offset ?? 0);
        const pending = () => updates.filter((u) => (u as { update_id: number }).update_id >= offset);
        if (!pending().length) {
          const wait = Math.min(Number(body.timeout ?? 0), 2) * 1000;
          await new Promise<void>((resolve) => {
            const done = () => { waiters.delete(done); resolve(); };
            waiters.add(done);
            setTimeout(done, wait);
          });
        }
        return reply(pending());
      }
      case "sendMessage":
      case "editMessageText": {
        const chatId = String(body.chat_id ?? "");
        const text = String(body.text ?? "");
        sent.push({ method, chatId, text });
        return reply(message(chatId, text));
      }
      case "getChat":
        return reply({ id: Number(body.chat_id ?? 0), type: "private", first_name: "Tester" });
      case "getMyCommands":
        return reply([]);
      case "getWebhookInfo":
        return reply({ url: "", has_custom_certificate: false, pending_update_count: 0 });
      default:
        return reply(true);
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}/bot`,
    calls,
    sent,
    say(fromId, text) {
      updates.push({
        update_id: nextUpdate++,
        message: { message_id: nextMessage++, date: Math.floor(Date.now() / 1000), chat: { id: fromId, type: "private", first_name: "Tester" }, from: { id: fromId, is_bot: false, first_name: "Tester" }, text },
      });
      for (const w of [...waiters]) w();
    },
    close: () => new Promise((resolve) => {
      for (const w of [...waiters]) w();
      server.closeAllConnections();
      server.close(() => resolve());
    }),
  };
}
