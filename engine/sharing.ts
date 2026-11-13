/**
 * Share on your network (M12a): teammates on the same network open this computer's boards in
 * their own McBot, live, with their own cursors. Off until the person turns it on.
 *
 * - Joining takes the invite: a link with a code (`http://<address>/join?code=…`), good for
 *   24 hours and for everyone the host sends it to, until the host makes a new one or stops
 *   sharing. Each member gets a key of their own; only its sha256 is kept, in
 *   <workspace>/sharing.json (owner-only). Failed joins are rate-limited.
 * - A member can work on boards: edit, compile, run agents, tasks, schedules. Never this
 *   computer's saved keys, its files and folders, its setup or its engine (`guestAllowed`).
 * - Agents always run here, on the host.
 */
import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { chmod } from "node:fs/promises";
import { networkInterfaces } from "node:os";
import { atomicWrite, readTextOrNull } from "./fsutil";

export interface Member {
  id: string;
  name: string;
  keySha256: string;
  joinedAt: number;
  lastSeen: number;
}

interface State {
  on: boolean;
  members: Member[];
  invite: { code: string; expiresAt: number } | null;
}

import type { SharingView } from "../src/contracts/api";
export type { SharingView };

export const INVITE_MS = 24 * 60 * 60_000;
/** No 0/O, 1/I/L: read out loud or typed from a screen. */
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const sha = (s: string) => createHash("sha256").update(s).digest("hex");

export function newCode(): string {
  const bytes = randomBytes(6);
  const chars = [...bytes].map((b) => ALPHABET[b % ALPHABET.length]).join("");
  return `${chars.slice(0, 3)}-${chars.slice(3)}`;
}

/** This computer's addresses other computers on the network can reach (IPv4, not loopback). */
export function lanAddresses(port: number): string[] {
  return Object.values(networkInterfaces()).flat().filter((i) => i && i.family === "IPv4" && !i.internal).map((i) => `${i!.address}:${port}`);
}

export class Sharing {
  private state: State | null = null;
  /** Failed joins per minute, so a code cannot be guessed. */
  private failures: number[] = [];

  constructor(private readonly file: string, readonly port: number) {}

  private async load(): Promise<State> {
    if (this.state) return this.state;
    try {
      const raw = JSON.parse((await readTextOrNull(this.file)) ?? "null") as Partial<State> | null;
      this.state = { on: raw?.on === true, members: Array.isArray(raw?.members) ? raw.members : [], invite: raw?.invite ?? null };
    } catch {
      this.state = { on: false, members: [], invite: null };
    }
    return this.state;
  }

  private async save(): Promise<void> {
    await atomicWrite(this.file, `${JSON.stringify(this.state, null, 2)}\n`);
    await chmod(this.file, 0o600).catch(() => undefined);
  }

  async view(): Promise<SharingView> {
    const s = await this.load();
    const invite = s.invite && s.invite.expiresAt > Date.now() ? s.invite : null;
    const addresses = s.on ? lanAddresses(this.port) : [];
    return {
      on: s.on, port: this.port, addresses, members: s.members.map(({ id, name, joinedAt, lastSeen }) => ({ id, name, joinedAt, lastSeen })), invite,
      link: invite && addresses[0] ? inviteLink(addresses[0], invite.code) : null,
    };
  }

  async isOn(): Promise<boolean> {
    return (await this.load()).on;
  }

  async setOn(on: boolean): Promise<void> {
    const s = await this.load();
    s.on = on;
    if (on && !(s.invite && s.invite.expiresAt > Date.now())) s.invite = { code: newCode(), expiresAt: Date.now() + INVITE_MS };
    if (!on) s.invite = null;
    await this.save();
  }

  async newInvite(): Promise<void> {
    const s = await this.load();
    s.invite = { code: newCode(), expiresAt: Date.now() + INVITE_MS };
    await this.save();
  }

  /** Trade a valid invite code for a member key. Null when the code is wrong, replaced or old. */
  async join(code: string, name: string, now = Date.now()): Promise<{ key: string; member: Member } | null> {
    this.failures = this.failures.filter((t) => t > now - 60_000);
    if (this.failures.length >= 5) return null;
    const s = await this.load();
    const want = code.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
    const have = s.invite?.code.replace("-", "") ?? "";
    const ok = s.on && s.invite && s.invite.expiresAt > now && want.length === have.length && timingSafeEqual(Buffer.from(want), Buffer.from(have));
    if (!ok) {
      this.failures.push(now);
      return null;
    }
    const key = `mcb_${randomBytes(24).toString("base64url")}`;
    const member: Member = { id: randomUUID(), name: name.trim().slice(0, 64) || "Guest", keySha256: sha(key), joinedAt: now, lastSeen: now };
    s.members.push(member);
    // Like a shared link: it stays good for the next teammate until it expires or is replaced.
    await this.save();
    return { key, member };
  }

  /** The member a key belongs to, while sharing is on. */
  async member(key: string | null | undefined): Promise<Member | null> {
    if (!key) return null;
    const s = await this.load();
    if (!s.on) return null;
    const h = Buffer.from(sha(key));
    const m = s.members.find((x) => timingSafeEqual(Buffer.from(x.keySha256), h)) ?? null;
    if (m && Date.now() - m.lastSeen > 60_000) {
      m.lastSeen = Date.now();
      void this.save();
    }
    return m;
  }

  async remove(id: string): Promise<void> {
    const s = await this.load();
    s.members = s.members.filter((m) => m.id !== id);
    await this.save();
  }
}

export const inviteLink = (address: string, code: string) => `http://${address}/join?code=${encodeURIComponent(code)}`;

/** What a teammate sees when they open the invite link in a web browser: how to join from McBot. */
export function joinPage(hostName: string): string {
  const esc = (v: string) => v.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Join on McBot</title>
<style>
:root{color-scheme:dark}body{margin:0;min-height:100vh;display:grid;place-items:center;background:#151516;color:#f5f5f7;font:15px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Inter,sans-serif}
main{max-width:460px;padding:32px 24px}h1{font-size:26px;letter-spacing:-.02em;margin:0 0 6px}p{color:#a1a1a6;margin:0 0 18px}
ol{padding-left:20px;color:#d1d1d6}li{margin:6px 0}code{display:block;margin:18px 0;padding:12px 14px;border-radius:10px;background:#2c2c2e;word-break:break-all;font:13px ui-monospace,Menlo,monospace}
button,a.btn{display:inline-block;border:0;border-radius:999px;padding:9px 16px;background:#fff;color:#000;font:inherit;font-weight:600;text-decoration:none;cursor:pointer;margin-right:8px}
a.btn.ghost{background:#2c2c2e;color:#f5f5f7}
</style></head><body><main>
<h1>You're invited</h1>
<p>${esc(hostName)} shared their McBot boards with you.</p>
<ol><li>Open McBot on your computer.</li><li>Click <b>Share</b>, then <b>Join someone else's</b>.</li><li>Paste this link.</li></ol>
<code id="link"></code>
<button id="copy">Copy link</button><a class="btn ghost" href="https://github.com/CasperCrypto/mcbot/releases/latest">Get McBot</a>
<script>
var l=document.getElementById("link");l.textContent=location.href;
document.getElementById("copy").onclick=function(){navigator.clipboard&&navigator.clipboard.writeText(location.href).then(function(){document.getElementById("copy").textContent="Copied"})};
</script>
</main></body></html>
`;
}

/**
 * What a member may do: work on boards, never this computer's keys, files, setup or engine.
 * `${method} ${path}` of engine/server.ts routes; anything not listed is refused (403).
 */
const GUEST_ROUTES = new Set([
  "GET /api/health", "GET /api/boards", "POST /api/boards", "GET /api/setup", "GET /api/hermes", "GET /api/secrets",
  "GET /api/compile", "POST /api/compile", "GET /api/runs", "POST /api/runs",
  "GET /api/memory", "PUT /api/memory", "GET /api/cost",
  "GET /api/tasks", "GET /api/tasks/one", "POST /api/tasks", "POST /api/tasks/act",
  "GET /api/schedules", "POST /api/schedules", "POST /api/schedules/act",
  "GET /api/events", "GET /api/media",
]);

export function guestAllowed(method: string, path: string): boolean {
  // A member may stop a run and answer its approval card, as the host can.
  if (/^\/api\/runs\/run_[a-z0-9]+_[a-f0-9]+(\/cancel|\/approval)?$/.test(path)) return method === "GET" || method === "POST";
  return GUEST_ROUTES.has(`${method} ${path}`);
}
