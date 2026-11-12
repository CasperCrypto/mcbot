/**
 * Hermes → the open board, live (decision 9, step c). An agent's files change in McBot's editor,
 * with the Hermes CLI, or by an agent itself; the board follows within a couple of seconds, for
 * everyone looking at it.
 *
 * Three-way (src/harness/reconcile.ts `followChanges`): McBot remembers each compiled agent's
 * files as it last saw them (<workspace>/hermes-seen.json), so only what changed in Hermes since
 * then reaches the board, and a board edit not compiled yet stays. What McBot writes itself
 * (compile) is remembered right away, so it never echoes back.
 */
import { join } from "node:path";
import { graphFromDoc } from "../src/board/ydoc";
import { applyToDoc } from "../src/harness/live";
import type { ProfileFiles } from "../src/harness/read";
import { followChanges } from "../src/harness/reconcile";
import { atomicWrite, readTextOrNull } from "./fsutil";
import { profileFiles } from "./harnessDisk";
import type { BoardRelay } from "./relay";
import { readManifest } from "./writer";

export interface HarnessChange {
  boardId: string;
  agent: string;
  /** What changed, in words ("soul", "model"). */
  changed: string[];
}

export class HermesSync {
  private seen: Record<string, ProfileFiles> | null = null;
  private timer: NodeJS.Timeout | null = null;
  private busy = false;

  constructor(
    private readonly root: string,
    private readonly file: string,
    private readonly relay: BoardRelay,
    private readonly onChange: (c: HarnessChange) => void,
  ) {}

  private async load(): Promise<Record<string, ProfileFiles>> {
    if (this.seen) return this.seen;
    try {
      this.seen = JSON.parse((await readTextOrNull(this.file)) ?? "{}") as Record<string, ProfileFiles>;
    } catch {
      this.seen = {};
    }
    return this.seen;
  }

  private async save(): Promise<void> {
    await atomicWrite(this.file, `${JSON.stringify(this.seen ?? {})}\n`);
  }

  private read(name: string): Promise<ProfileFiles> {
    return profileFiles(name, join(this.root, "profiles", name)).then((p) => p.files);
  }

  /** After McBot wrote these agents' files (a compile): this is now what Hermes has. */
  async remember(names: readonly string[]): Promise<void> {
    const seen = await this.load();
    for (const n of names) seen[n] = await this.read(n);
    await this.save();
  }

  /** Bring the board in line with one agent's files now. Returns what changed on the board. */
  async follow(boardId: string, name: string): Promise<HarnessChange | null> {
    const seen = await this.load();
    const now = await this.read(name);
    const room = await this.relay.room(boardId);
    const { edits, changed } = followChanges(graphFromDoc(room.doc), seen[name] ?? null, now);
    seen[name] = now;
    await this.save();
    if (!edits.length) return null;
    applyToDoc(room.doc, edits);
    const change = { boardId, agent: name, changed };
    this.onChange(change);
    return change;
  }

  /** One look at every compiled agent's files; follows the ones that changed. */
  async tick(): Promise<HarnessChange[]> {
    if (this.busy) return [];
    this.busy = true;
    try {
      const manifest = await readManifest(this.root).catch(() => null);
      if (!manifest || !(await this.relay.exists(manifest.graphId))) return [];
      const seen = await this.load();
      const out: HarnessChange[] = [];
      for (const name of manifest.profiles) {
        const now = await this.read(name);
        if (!seen[name]) {
          // First look (before any compile McBot remembers): this is the starting point.
          seen[name] = now;
          await this.save();
          continue;
        }
        if (JSON.stringify(now) === JSON.stringify(seen[name])) continue;
        const c = await this.follow(manifest.graphId, name);
        if (c) out.push(c);
      }
      return out;
    } finally {
      this.busy = false;
    }
  }

  start(everyMs = 2000): void {
    this.timer ??= setInterval(() => void this.tick().catch((err: unknown) => console.warn(`[engine] following Hermes: ${String(err)}`)), everyMs);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}
