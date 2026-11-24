/**
 * Share (M12a): invite people to this computer's boards with a link, like a shared document.
 * Off until the person turns it on.
 *
 * - Who it reaches: people on the same network (`http://<address>:4318`), or anyone with the link
 *   through a free Cloudflare quick tunnel (engine/tunnel.ts) or the host's own address (`ownUrl`).
 * - A link per role, good for 24 hours and for everyone it is sent to, until the host makes a new
 *   one or stops sharing: **Can edit** (teammates: boards, compile, runs, tasks, schedules) or
 *   **Can chat** (customers, guests: only a chat with the agents the host picked, and only their
 *   own messages). Each member gets a key of their own; only its sha256 is kept, in
 *   <workspace>/sharing.json (owner-only). Failed joins are rate-limited per person and overall.
 * - Never this computer's saved keys, its files and folders, its setup or its engine
 *   (`guestAllowed`). Agents always run here, on the host.
 */
import { createHash, randomBytes, randomInt, randomUUID, timingSafeEqual } from "node:crypto";
import { chmod } from "node:fs/promises";
import { networkInterfaces } from "node:os";
import type { ShareRole, SharingView } from "../src/contracts/api";
import { atomicWrite, readTextOrNull } from "./fsutil";

export type { SharingView };
export type Role = ShareRole;
export type Reach = "network" | "internet";

/** What a link or a member may reach: everything (edit), or a chat with some agents of one board. */
export interface Scope {
  role: Role;
  /** Chat: the board whose agents they talk to. */
  boardId?: string;
  /** Chat: those agents (node ids); empty or absent = every agent on that board. */
  agents?: string[];
}

export interface Member extends Scope {
  id: string;
  name: string;
  keySha256: string;
  joinedAt: number;
  lastSeen: number;
}

export interface Invite extends Scope {
  code: string;
  expiresAt: number;
}

interface State {
  on: boolean;
  reach: Reach;
  /** The host's own public address for this port (a named tunnel, a reverse proxy, Tailscale). */
  ownUrl: string | null;
  members: Member[];
  invites: Invite[];
}

export const INVITE_MS = 24 * 60 * 60_000;
/** No 0/O, 1/I/L: read out loud or typed from a screen. */
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const sha = (s: string) => createHash("sha256").update(s).digest("hex");

/** A link's code: nine letters and digits (31⁹ ≈ 2.6·10¹³), in threes, each one equally likely. */
export function newCode(): string {
  const chars = Array.from({ length: 9 }, () => ALPHABET[randomInt(ALPHABET.length)]).join("");
  return `${chars.slice(0, 3)}-${chars.slice(3, 6)}-${chars.slice(6)}`;
}

/** This computer's addresses other computers on the network can reach (IPv4, not loopback). */
export function lanAddresses(port: number): string[] {
  return Object.values(networkInterfaces()).flat().filter((i) => i && i.family === "IPv4" && !i.internal).map((i) => `${i!.address}:${port}`);
}

/** `https://team.example.com/` → `https://team.example.com`; null for anything that isn't a plain web address. */
export function cleanOwnUrl(text: string): string | null {
  try {
    const u = new URL(text.trim());
    if ((u.protocol !== "https:" && u.protocol !== "http:") || u.username || u.password || (u.pathname !== "/" && u.pathname !== "") || u.search || u.hash) return null;
    return u.origin;
  } catch {
    return null;
  }
}

const scopeKey = (s: Scope) => (s.role === "edit" ? "edit" : `chat:${s.boardId ?? ""}:${[...(s.agents ?? [])].sort().join(",")}`);
const scopeOf = (s: Scope): Scope => (s.role === "edit" ? { role: "edit" } : { role: "chat", boardId: s.boardId, agents: [...new Set(s.agents ?? [])].sort() });
const sameCode = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
const bare = (code: string) => code.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");

export const inviteLink = (address: string, code: string) => `${/^https?:\/\//.test(address) ? address : `http://${address}`}/join?code=${encodeURIComponent(code)}`;

export class Sharing {
  private state: State | null = null;
  /** Failed joins in the last minute, per person and in all, so a code cannot be guessed. */
  private failures = new Map<string, number[]>();

  /** `publicUrl` is the quick tunnel's address while it is up. */
  constructor(private readonly file: string, readonly port: number, private readonly publicUrl: () => string | null = () => null) {}

  private async load(): Promise<State> {
    if (this.state) return this.state;
    try {
      const raw = JSON.parse((await readTextOrNull(this.file)) ?? "null") as (Partial<State> & { invite?: { code: string; expiresAt: number } | null }) | null;
      const invites = Array.isArray(raw?.invites) ? raw.invites : raw?.invite ? [{ ...raw.invite, role: "edit" as const }] : [];
      this.state = {
        on: raw?.on === true,
        reach: raw?.reach === "internet" ? "internet" : "network",
        ownUrl: typeof raw?.ownUrl === "string" ? cleanOwnUrl(raw.ownUrl) : null,
        members: (Array.isArray(raw?.members) ? raw.members : []).map((m) => ({ ...m, role: m.role === "chat" ? "chat" : "edit" })),
        invites: invites.map((i) => ({ ...i, role: i.role === "chat" ? "chat" : "edit" })),
      };
    } catch {
      this.state = { on: false, reach: "network", ownUrl: null, members: [], invites: [] };
    }
    return this.state;
  }

  private async save(): Promise<void> {
    await atomicWrite(this.file, `${JSON.stringify(this.state, null, 2)}\n`);
    await chmod(this.file, 0o600).catch(() => undefined);
  }

  /** Where a link points: the host's own address, the tunnel, or this computer on the network. */
  private base(s: State, addresses: string[]): string | null {
    if (s.reach === "internet") return s.ownUrl ?? this.publicUrl();
    return addresses[0] ? `http://${addresses[0]}` : null;
  }

  /** Origins the app may be opened from when people join in a browser: this port's addresses. */
  async origins(): Promise<Set<string>> {
    const s = await this.load();
    const out = new Set<string>();
    if (!s.on) return out;
    for (const a of lanAddresses(this.port)) out.add(`http://${a}`);
    out.add(`http://127.0.0.1:${this.port}`);
    out.add(`http://localhost:${this.port}`);
    const pub = this.publicUrl();
    if (pub) out.add(new URL(pub).origin);
    if (s.ownUrl) out.add(s.ownUrl);
    return out;
  }

  async view(): Promise<Omit<SharingView, "tunnel" | "web">> {
    const s = await this.load();
    const now = Date.now();
    const addresses = s.on ? lanAddresses(this.port) : [];
    const base = s.on ? this.base(s, addresses) : null;
    const live = s.invites.filter((i) => i.expiresAt > now);
    const edit = live.find((i) => i.role === "edit") ?? null;
    return {
      on: s.on, port: this.port, addresses, reach: s.reach, ownUrl: s.ownUrl, publicUrl: s.reach === "internet" ? base : null,
      members: s.members.map(({ id, name, joinedAt, lastSeen, role, boardId, agents }) => ({ id, name, joinedAt, lastSeen, role, ...(role === "chat" ? { boardId, agents: agents ?? [] } : {}) })),
      invite: edit ? { code: edit.code, expiresAt: edit.expiresAt } : null,
      link: edit && base ? inviteLink(base, edit.code) : null,
      invites: live.map((i) => ({ code: i.code, expiresAt: i.expiresAt, role: i.role, ...(i.role === "chat" ? { boardId: i.boardId, agents: i.agents ?? [] } : {}), link: base ? inviteLink(base, i.code) : null })),
    };
  }

  async isOn(): Promise<boolean> {
    return (await this.load()).on;
  }

  async reach(): Promise<{ reach: Reach; ownUrl: string | null }> {
    const s = await this.load();
    return { reach: s.reach, ownUrl: s.ownUrl };
  }

  async setOn(on: boolean): Promise<void> {
    const s = await this.load();
    s.on = on;
    if (on && !s.invites.some((i) => i.role === "edit" && i.expiresAt > Date.now())) s.invites.push({ role: "edit", code: newCode(), expiresAt: Date.now() + INVITE_MS });
    if (!on) s.invites = [];
    await this.save();
  }

  async setReach(reach: Reach, ownUrl: string | null): Promise<void> {
    const s = await this.load();
    s.reach = reach;
    s.ownUrl = ownUrl;
    await this.save();
  }

  /** The link for a role (and, to chat, which agents): the live one, or a new one when `fresh` or none. */
  async invite(scope: Scope = { role: "edit" }, fresh = true): Promise<Invite> {
    const s = await this.load();
    const want = scopeOf(scope);
    const key = scopeKey(want);
    const live = s.invites.find((i) => scopeKey(i) === key && i.expiresAt > Date.now());
    if (live && !fresh) return live;
    const made: Invite = { ...want, code: newCode(), expiresAt: Date.now() + INVITE_MS };
    // A new link replaces the old one for the same people; the others keep working.
    s.invites = [...s.invites.filter((i) => scopeKey(i) !== key && i.expiresAt > Date.now()), made];
    await this.save();
    return made;
  }

  /** The old name for a new teammate link (Share's "New link"). */
  async newInvite(): Promise<void> {
    await this.invite({ role: "edit" }, true);
  }

  private limited(who: string, now: number): boolean {
    for (const [k, list] of this.failures) {
      const kept = list.filter((t) => t > now - 60_000);
      if (kept.length) this.failures.set(k, kept);
      else this.failures.delete(k);
    }
    const all = [...this.failures.values()].reduce((n, l) => n + l.length, 0);
    return (this.failures.get(who)?.length ?? 0) >= 5 || all >= 60;
  }

  /**
   * Trade a live link's code for a member key, with that link's role. Null when the code is wrong,
   * replaced or old, or after too many wrong ones (`who`: where the try came from).
   */
  async join(code: string, name: string, now = Date.now(), who = "anyone"): Promise<{ key: string; member: Member } | null> {
    if (this.limited(who, now)) return null;
    const s = await this.load();
    const want = bare(code);
    const invite = s.on ? s.invites.find((i) => i.expiresAt > now && sameCode(want, bare(i.code))) : undefined;
    if (!invite) {
      this.failures.set(who, [...(this.failures.get(who) ?? []), now]);
      return null;
    }
    const key = `mcb_${randomBytes(24).toString("base64url")}`;
    const member: Member = { id: randomUUID(), name: name.trim().slice(0, 64) || "Guest", keySha256: sha(key), joinedAt: now, lastSeen: now, ...scopeOf(invite) };
    s.members.push(member);
    // Like a shared link: it stays good for the next person until it expires or is replaced.
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

/**
 * What someone sees when they open a link and this McBot can't show its app in a browser (it
 * wasn't built with it): how to join from McBot.
 */
export function joinPage(hostName: string): string {
  const esc = (v: string) => v.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Join on McBot Studio</title>
<style>
:root{color-scheme:dark}body{margin:0;min-height:100vh;display:grid;place-items:center;background:#151516;color:#f5f5f7;font:15px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Inter,sans-serif}
main{max-width:460px;padding:32px 24px}h1{font-size:26px;letter-spacing:-.02em;margin:0 0 6px}p{color:#a1a1a6;margin:0 0 18px}
ol{padding-left:20px;color:#d1d1d6}li{margin:6px 0}code{display:block;margin:18px 0;padding:12px 14px;border-radius:10px;background:#2c2c2e;word-break:break-all;font:13px ui-monospace,Menlo,monospace}
button,a.btn{display:inline-block;border:0;border-radius:999px;padding:9px 16px;background:#fff;color:#000;font:inherit;font-weight:600;text-decoration:none;cursor:pointer;margin-right:8px}
a.btn.ghost{background:#2c2c2e;color:#f5f5f7}
</style></head><body><main>
<h1>You're invited</h1>
<p>${esc(hostName)} shared their McBot Studio with you.</p>
<ol><li>Open McBot Studio on your computer.</li><li>Click <b>Share</b>, then <b>Join someone else's</b>.</li><li>Paste this link.</li></ol>
<code id="link"></code>
<button id="copy">Copy link</button><a class="btn ghost" href="https://mcbot.studio">Get McBot Studio</a>
<script>
var l=document.getElementById("link");l.textContent=location.href;
document.getElementById("copy").onclick=function(){navigator.clipboard&&navigator.clipboard.writeText(location.href).then(function(){document.getElementById("copy").textContent="Copied"})};
</script>
</main></body></html>
`;
}

/**
 * What a teammate (Can edit) may do: work on boards, never this computer's keys, files, setup or
 * engine. `${method} ${path}` of engine/server.ts routes; anything not listed is refused (403).
 */
const EDIT_ROUTES = new Set([
  "GET /api/health", "GET /api/guest", "GET /api/boards", "POST /api/boards", "GET /api/setup", "GET /api/hermes", "GET /api/secrets",
  "GET /api/compile", "POST /api/compile", "GET /api/versions", "POST /api/versions/name", "GET /api/runs", "POST /api/runs",
  "GET /api/memory", "PUT /api/memory", "GET /api/cost",
  "GET /api/tasks", "GET /api/tasks/one", "POST /api/tasks", "POST /api/tasks/act",
  "GET /api/schedules", "POST /api/schedules", "POST /api/schedules/act",
  "GET /api/events", "GET /api/media", "GET /api/ratings", "POST /api/ratings", "GET /api/learn",
]);

/** A guest (Can chat): their chat with the agents they were given, nothing else. */
const CHAT_ROUTES = new Set(["GET /api/health", "GET /api/guest", "GET /api/runs", "POST /api/runs", "GET /api/events", "GET /api/media"]);

const RUN_PATH = /^\/api\/runs\/run_[a-z0-9]+_[a-f0-9]+(\/cancel|\/approval)?$/;

export function guestAllowed(method: string, path: string, role: Role = "edit"): boolean {
  const run = RUN_PATH.exec(path);
  if (run) {
    // A teammate may stop a run and answer its approval card, as the host can; a guest may stop
    // their own run, and only the host answers what their agent asks.
    if (role === "chat") return (method === "GET" && !run[1]) || (method === "POST" && run[1] === "/cancel");
    return method === "GET" || method === "POST";
  }
  return (role === "chat" ? CHAT_ROUTES : EDIT_ROUTES).has(`${method} ${path}`);
}
