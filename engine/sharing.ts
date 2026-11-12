/**
 * Share on your network (M12a): teammates on the same network open this computer's boards in
 * their own McBot, live, with their own cursors. Off until the person turns it on.
 *
 * - Joining takes a one-time invite code (15 minutes) and gives the member a key of their own;
 *   only its sha256 is kept, in <workspace>/sharing.json (owner-only).
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

const INVITE_MS = 15 * 60_000;
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
    return { on: s.on, port: this.port, addresses: s.on ? lanAddresses(this.port) : [], members: s.members.map(({ id, name, joinedAt, lastSeen }) => ({ id, name, joinedAt, lastSeen })), invite };
  }

  async isOn(): Promise<boolean> {
    return (await this.load()).on;
  }

  async setOn(on: boolean): Promise<void> {
    const s = await this.load();
    s.on = on;
    if (on && !s.invite) s.invite = { code: newCode(), expiresAt: Date.now() + INVITE_MS };
    if (!on) s.invite = null;
    await this.save();
  }

  async newInvite(): Promise<void> {
    const s = await this.load();
    s.invite = { code: newCode(), expiresAt: Date.now() + INVITE_MS };
    await this.save();
  }

  /** Trade a valid invite code for a member key (once). Null when the code is wrong, used or old. */
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
    // One code, one person: the host makes a new code for the next teammate.
    s.invite = null;
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
