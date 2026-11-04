/**
 * API keys the user typed into McBot (setup assistant, later the connections
 * hub). They never go on a board or into compiled files: model nodes carry only
 * the variable's name, and the runner hands the values to Hermes as environment
 * variables. Stored in <workspace>/secrets.json, readable by the owner only.
 * (The OS keychain replaces this file in M6, docs/PLAN.md.)
 */
import { chmod, writeFile } from "node:fs/promises";
import { readTextOrNull } from "./fsutil";

export const SECRET_NAME_RE = /^[A-Z_][A-Z0-9_]{0,63}$/;

export class SecretError extends Error {}

export class Secrets {
  constructor(private readonly file: string) {}

  private async read(): Promise<Record<string, string>> {
    try {
      const raw = JSON.parse((await readTextOrNull(this.file)) ?? "{}") as Record<string, unknown>;
      return Object.fromEntries(Object.entries(raw).filter((e): e is [string, string] => SECRET_NAME_RE.test(e[0]) && typeof e[1] === "string"));
    } catch {
      return {};
    }
  }

  private async write(all: Record<string, string>): Promise<void> {
    await writeFile(this.file, `${JSON.stringify(all, null, 2)}\n`, { mode: 0o600 });
    await chmod(this.file, 0o600).catch(() => undefined); // no-op on Windows
  }

  async names(): Promise<string[]> {
    return Object.keys(await this.read()).sort();
  }

  async set(name: string, value: string): Promise<void> {
    if (!SECRET_NAME_RE.test(name)) throw new SecretError("Key names use A–Z, 0–9 and _ (like OPENAI_API_KEY)");
    const v = value.trim();
    if (!v || v.length > 4096 || /[\r\n\0]/.test(v)) throw new SecretError("That key doesn't look right");
    await this.write({ ...(await this.read()), [name]: v });
  }

  async remove(name: string): Promise<void> {
    const all = await this.read();
    delete all[name];
    await this.write(all);
  }

  /** Values for a child process's environment. */
  async env(): Promise<Record<string, string>> {
    return this.read();
  }
}
