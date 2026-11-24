/**
 * Passwords (views/PasswordsView.tsx): the person's logins to websites, for the browser.
 *
 * Kept in <workspace>/logins.json (owner-only), each password sealed with AES-256-GCM under a key
 * of its own in McBot's data folder (`keyFile`, owner-only, outside the workspace), so the McBot
 * folder alone (a backup, a synced copy) holds no readable password. A password leaves the engine
 * only to McBot's own window on this computer, when the person copies or fills it
 * (`POST /api/logins/reveal`); never to someone who joined (engine/sharing.ts), never in a list.
 * Hermes never sees them: these are the person's, not an agent's.
 */
import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from "node:crypto";
import { chmod, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { atomicWrite, readTextOrNull } from "./fsutil";

export interface LoginView {
  id: string;
  /** Where it is used: `https://mail.google.com`. */
  url: string;
  host: string;
  username: string;
  note: string;
  updatedAt: number;
}

interface Sealed { iv: string; tag: string; data: string }
interface Stored extends LoginView { password: Sealed }

export class LoginError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

/** `mail.google.com/mail` → `https://mail.google.com`; null for anything that isn't a web address. */
export function loginSite(text: string): { url: string; host: string } | null {
  const t = text.trim();
  try {
    const u = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(t) ? t : `https://${t}`);
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    if (!u.hostname.includes(".") && u.hostname !== "localhost") return null;
    return { url: u.origin, host: u.hostname.toLowerCase() };
  } catch {
    return null;
  }
}

/** Does a login for `saved` belong on a page at `host`? The same site, or one of its own subdomains. */
export const sameSite = (saved: string, host: string) => {
  const a = saved.toLowerCase().replace(/^www\./, "");
  const b = host.toLowerCase().replace(/^www\./, "");
  return a === b || b.endsWith(`.${a}`);
};

export class Logins {
  private cache: Stored[] | null = null;
  private key: Buffer | null = null;

  constructor(private readonly file: string, private readonly keyFile: string) {}

  private async secret(create: boolean): Promise<Buffer | null> {
    if (this.key) return this.key;
    const raw = await readTextOrNull(this.keyFile);
    if (raw && /^[a-f0-9]{64}$/.test(raw.trim())) return (this.key = Buffer.from(raw.trim(), "hex"));
    if (!create) return null;
    const made = randomBytes(32);
    await mkdir(dirname(this.keyFile), { recursive: true });
    await atomicWrite(this.keyFile, `${made.toString("hex")}\n`);
    await chmod(this.keyFile, 0o600).catch(() => undefined);
    return (this.key = made);
  }

  private async load(): Promise<Stored[]> {
    if (this.cache) return this.cache;
    try {
      const raw = JSON.parse((await readTextOrNull(this.file)) ?? "[]") as unknown;
      this.cache = Array.isArray(raw) ? (raw as Stored[]).filter((l) => l && typeof l.id === "string" && l.password?.data) : [];
    } catch {
      this.cache = [];
    }
    return this.cache;
  }

  private async save(): Promise<void> {
    await atomicWrite(this.file, `${JSON.stringify(this.cache, null, 2)}\n`);
    await chmod(this.file, 0o600).catch(() => undefined);
  }

  private async seal(password: string): Promise<Sealed> {
    const key = (await this.secret(true))!;
    const iv = randomBytes(12);
    const c = createCipheriv("aes-256-gcm", key, iv);
    const data = Buffer.concat([c.update(password, "utf8"), c.final()]);
    return { iv: iv.toString("base64"), tag: c.getAuthTag().toString("base64"), data: data.toString("base64") };
  }

  private async open(s: Sealed): Promise<string> {
    const key = await this.secret(false);
    if (!key) throw new LoginError(409, "This password was saved on another computer. Save it again here.");
    try {
      const d = createDecipheriv("aes-256-gcm", key, Buffer.from(s.iv, "base64"));
      d.setAuthTag(Buffer.from(s.tag, "base64"));
      return Buffer.concat([d.update(Buffer.from(s.data, "base64")), d.final()]).toString("utf8");
    } catch {
      throw new LoginError(409, "This password can't be read here. Save it again.");
    }
  }

  /** Every login, without its password; or the ones for a page's site. */
  async list(host?: string): Promise<LoginView[]> {
    const all = await this.load();
    return all.filter((l) => !host || sameSite(l.host, host)).map(({ id, url, host: h, username, note, updatedAt }) => ({ id, url, host: h, username, note, updatedAt }))
      .sort((a, b) => a.host.localeCompare(b.host) || a.username.localeCompare(b.username));
  }

  /** Add one, or change one (`id`); leaving the password out keeps the saved one. */
  async put(input: { id?: string; url: string; username: string; password?: string; note?: string }, now = Date.now()): Promise<LoginView> {
    const site = loginSite(input.url);
    if (!site) throw new LoginError(400, "Use the site's address, like mail.google.com");
    const all = await this.load();
    const old = input.id ? all.find((l) => l.id === input.id) : undefined;
    if (input.id && !old) throw new LoginError(404, "No such login");
    if (!old && !input.password) throw new LoginError(400, "Type the password");
    const next: Stored = {
      id: old?.id ?? randomUUID(), url: site.url, host: site.host, username: input.username.trim().slice(0, 200), note: (input.note ?? old?.note ?? "").slice(0, 500),
      updatedAt: now, password: input.password ? await this.seal(input.password) : old!.password,
    };
    this.cache = [...all.filter((l) => l.id !== next.id), next];
    await this.save();
    const { password: _sealed, ...view } = next;
    return view;
  }

  async remove(id: string): Promise<void> {
    const all = await this.load();
    this.cache = all.filter((l) => l.id !== id);
    await this.save();
  }

  /** The password itself, for McBot's own window (copy, fill). */
  async reveal(id: string): Promise<{ username: string; password: string; host: string }> {
    const l = (await this.load()).find((x) => x.id === id);
    if (!l) throw new LoginError(404, "No such login");
    return { username: l.username, password: await this.open(l.password), host: l.host };
  }
}
