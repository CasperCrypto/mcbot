/**
 * "Anyone with the link" (Share): a free Cloudflare quick tunnel gives this computer's share port a
 * public https address (`https://<words>.trycloudflare.com`), with no account and nothing to set up.
 *
 * cloudflared (Cloudflare's own client, Apache-2.0) comes from MCBOT_CLOUDFLARED, the PATH, or is
 * downloaded once from its GitHub releases into McBot's tools folder and checked against the SHA256
 * its release notes list ("cloudflared-linux-amd64: <hex>"). It runs with a home folder of its own,
 * because quick tunnels refuse to start beside a `~/.cloudflared/config.yaml`.
 *
 * What quick tunnels are: no Server-Sent Events (McBot's events go over a WebSocket for anyone who
 * joined), at most 200 requests in flight, no uptime guarantee, and a new address every time one
 * starts. A permanent address is the host's own (`ownUrl` in engine/sharing.ts).
 */
import { spawn, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { chmod, mkdir, rename, rm, writeFile } from "node:fs/promises";
import { delimiter, join } from "node:path";
import { createInterface } from "node:readline";

/** The address cloudflared prints once a quick tunnel is up. */
export const QUICK_URL = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/;

/** cloudflared's release file for this computer; Windows on Arm runs the x64 one. */
export function cloudflaredAsset(platform: string = process.platform, arch: string = process.arch): string | null {
  if (platform === "darwin") return arch === "arm64" ? "cloudflared-darwin-arm64.tgz" : arch === "x64" ? "cloudflared-darwin-amd64.tgz" : null;
  if (platform === "win32") return arch === "ia32" ? "cloudflared-windows-386.exe" : "cloudflared-windows-amd64.exe";
  if (platform === "linux") return ({ x64: "cloudflared-linux-amd64", arm64: "cloudflared-linux-arm64", arm: "cloudflared-linux-arm", ia32: "cloudflared-linux-386" } as Record<string, string>)[arch] ?? null;
  return null;
}

/** The SHA256 a cloudflared release lists for one of its files, or null when it lists none. */
export function releaseChecksum(body: string, asset: string): string | null {
  const name = asset.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^\\s*${name}:\\s*([a-fA-F0-9]{64})\\s*$`, "m").exec(body)?.[1]?.toLowerCase() ?? null;
}

const EXE = process.platform === "win32" ? "cloudflared.exe" : "cloudflared";

function onPath(file: string): string | null {
  for (const dir of (process.env.PATH ?? "").split(delimiter)) {
    if (dir && existsSync(join(dir, file))) return join(dir, file);
  }
  return null;
}

const run = (file: string, args: string[]) => new Promise<void>((resolve, reject) => {
  const child = spawn(file, args, { stdio: "ignore", windowsHide: true });
  child.on("error", reject);
  child.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`${file} exited ${code}`))));
});

const UA = { "user-agent": "McBot-Studio" };

/** A cloudflared to run: MCBOT_CLOUDFLARED, one on the PATH, the one downloaded before, or a new download. */
export async function ensureCloudflared(toolsDir: string, log: (line: string) => void = () => undefined): Promise<string> {
  const own = process.env.MCBOT_CLOUDFLARED?.trim();
  if (own) {
    if (!existsSync(own)) throw new Error(`MCBOT_CLOUDFLARED names ${own}, which isn't there`);
    return own;
  }
  const found = onPath(EXE);
  if (found) return found;
  const target = join(toolsDir, EXE);
  if (existsSync(target)) return target;

  const asset = cloudflaredAsset();
  if (!asset) throw new Error(`Cloudflare has no tunnel client for ${process.platform} ${process.arch}`);
  const res = await fetch("https://api.github.com/repos/cloudflare/cloudflared/releases/latest", { headers: { ...UA, accept: "application/vnd.github+json" } });
  if (!res.ok) throw new Error(`GitHub answered ${res.status} for Cloudflare's tunnel client`);
  const release = (await res.json()) as { tag_name?: string; body?: string; assets?: { name: string; browser_download_url: string }[] };
  const file = release.assets?.find((a) => a.name === asset);
  const want = releaseChecksum(release.body ?? "", asset);
  if (!file || !want) throw new Error(`cloudflared ${release.tag_name ?? ""} lists no checksum for ${asset}`);
  log(`[share] downloading ${asset} ${release.tag_name ?? ""}`);
  const got = await fetch(file.browser_download_url, { headers: UA });
  if (!got.ok) throw new Error(`The tunnel client's download answered ${got.status}`);
  const bytes = Buffer.from(await got.arrayBuffer());
  if (createHash("sha256").update(bytes).digest("hex") !== want) throw new Error("The tunnel client's download didn't match its checksum, so it wasn't used");

  await mkdir(toolsDir, { recursive: true });
  const part = join(toolsDir, `.${asset}.part`);
  await writeFile(part, bytes);
  if (asset.endsWith(".tgz")) {
    // macOS ships it as a .tgz holding one `cloudflared`; tar is part of macOS.
    const unpack = join(toolsDir, ".cloudflared-unpack");
    await rm(unpack, { recursive: true, force: true });
    await mkdir(unpack, { recursive: true });
    await run("tar", ["-xzf", part, "-C", unpack]);
    await rename(join(unpack, "cloudflared"), target);
    await rm(unpack, { recursive: true, force: true });
    await rm(part, { force: true });
  } else {
    await rename(part, target);
  }
  if (process.platform !== "win32") await chmod(target, 0o755);
  return target;
}

/** `cloudflared tunnel --url …`, in a home of its own (quick tunnels refuse a config.yaml). */
export async function launchQuickTunnel(toolsDir: string, port: number, log?: (line: string) => void): Promise<ChildProcess> {
  const bin = await ensureCloudflared(toolsDir, log);
  const home = join(toolsDir, "cloudflared-home");
  await mkdir(home, { recursive: true });
  return spawn(bin, ["tunnel", "--no-autoupdate", "--url", `http://127.0.0.1:${port}`], {
    env: { ...process.env, HOME: home, USERPROFILE: home },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
}

export type TunnelState = "off" | "starting" | "on" | "failed";
export interface TunnelView { state: TunnelState; url: string | null; error: string | null }

export interface TunnelOptions {
  port: number;
  launch: (port: number) => Promise<ChildProcess>;
  onChange?: (view: TunnelView) => void;
  log?: (line: string) => void;
  /** How long to wait for the address (cloudflared prints it within seconds). */
  timeoutMs?: number;
}

/** One quick tunnel while sharing with anyone is on; it comes back by itself if it drops. */
export class Tunnel {
  private child: ChildProcess | null = null;
  private state: TunnelView = { state: "off", url: null, error: null };
  private wanted = false;
  private retry: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly opts: TunnelOptions) {}

  view(): TunnelView {
    return { ...this.state };
  }

  start(): void {
    if (this.wanted) return;
    this.wanted = true;
    void this.spawn(0);
  }

  stop(): void {
    this.wanted = false;
    if (this.retry) clearTimeout(this.retry);
    this.retry = null;
    const child = this.child;
    this.child = null;
    child?.kill();
    this.set({ state: "off", url: null, error: null });
  }

  private set(next: TunnelView): void {
    this.state = next;
    this.opts.onChange?.(this.view());
  }

  private fail(error: string, attempt: number): void {
    this.set({ state: "failed", url: null, error });
    if (!this.wanted || attempt >= 6) return;
    this.retry = setTimeout(() => {
      this.retry = null;
      if (this.wanted) void this.spawn(attempt + 1);
    }, Math.min(30_000, 1500 * 2 ** attempt));
  }

  private async spawn(attempt: number): Promise<void> {
    this.set({ state: "starting", url: null, error: null });
    let child: ChildProcess;
    try {
      child = await this.opts.launch(this.opts.port);
    } catch (err) {
      this.fail((err as Error).message, attempt);
      return;
    }
    if (!this.wanted) {
      child.kill();
      return;
    }
    this.child = child;
    const timer = setTimeout(() => {
      if (this.child === child && this.state.state === "starting") {
        this.child = null;
        child.kill();
        this.fail("Cloudflare didn't answer. Is this computer online?", attempt);
      }
    }, this.opts.timeoutMs ?? 60_000);
    const read = (stream: NodeJS.ReadableStream | null) => {
      if (!stream) return;
      createInterface({ input: stream }).on("line", (line) => {
        this.opts.log?.(line);
        const url = QUICK_URL.exec(line)?.[0];
        if (url && this.child === child && this.state.state !== "on") {
          clearTimeout(timer);
          this.set({ state: "on", url, error: null });
        }
      });
    };
    read(child.stdout);
    read(child.stderr);
    const ended = (why: string) => {
      clearTimeout(timer);
      if (this.child !== child) return;
      this.child = null;
      // A link that was up starts over from the first try; one that never came up backs off.
      if (this.wanted) this.fail(why, this.state.state === "on" ? 0 : attempt);
    };
    child.on("error", (err) => ended(`The tunnel client couldn't start: ${err.message}`));
    child.on("exit", (code) => ended(`The link dropped (the tunnel client stopped${code === null ? "" : `, code ${code}`})`));
  }
}
