/**
 * The shared board relay: the y-websocket wire protocol (sync + awareness) on
 * y-protocols, one Y.Doc per board, persisted as plain JSON in
 * <workspace>/boards/<boardId>.json. No auth in v0 — the engine only listens
 * on loopback and checks Origin/Host (engine/server.ts).
 *
 * Message framing matches y-websocket: varuint type (0 sync, 1 awareness,
 * 3 query-awareness) followed by the y-protocols payload.
 */
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import * as decoding from "lib0/decoding";
import * as encoding from "lib0/encoding";
import * as awarenessProtocol from "y-protocols/awareness";
import * as syncProtocol from "y-protocols/sync";
import type { WebSocket } from "ws";
import * as Y from "yjs";
import { z } from "zod";
import { GRAPH_SCHEMA, NoteSchema, MessageSchema, emptyGraph, type Graph } from "../src/contracts/graph";
import { graphFromDoc, loadGraphIntoDoc } from "../src/board/ydoc";
import { atomicWrite, readTextOrNull } from "./fsutil";

const MSG_SYNC = 0;
const MSG_AWARENESS = 1;
const MSG_QUERY_AWARENESS = 3;

export const BOARD_ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

/**
 * Structure only. A board being edited is routinely not compile-valid (a name
 * half typed); the compiler validates, the store never rejects or rewrites.
 */
export const LooseGraph = z.object({
  schema: z.literal(GRAPH_SCHEMA),
  id: z.string(),
  name: z.string().default(""),
  nodes: z.array(z.object({ id: z.string(), kind: z.string(), position: z.object({ x: z.number(), y: z.number() }), data: z.record(z.string(), z.unknown()) })),
  edges: z.array(z.object({ id: z.string(), source: z.string(), target: z.string(), order: z.number().default(0) })),
  /** Sticky notes; a malformed one is dropped, never the board. */
  notes: z.array(z.unknown()).optional().transform((list) => list?.flatMap((n) => { const r = NoteSchema.safeParse(n); return r.success ? [r.data] : []; })),
  /** Team chat; a malformed message is dropped, never the board. */
  messages: z.array(z.unknown()).optional().transform((list) => list?.flatMap((n) => { const r = MessageSchema.safeParse(n); return r.success ? [r.data] : []; })),
});

interface Room {
  id: string;
  doc: Y.Doc;
  awareness: awarenessProtocol.Awareness;
  conns: Map<WebSocket, Set<number>>;
  saveTimer: NodeJS.Timeout | null;
  saving: Promise<void>;
}

function send(conn: WebSocket, msg: Uint8Array) {
  if (conn.readyState === conn.OPEN) conn.send(msg, (err) => err && conn.close());
}

export class BoardRelay {
  private readonly rooms = new Map<string, Promise<Room>>();

  constructor(readonly dir: string, private readonly onChange?: (boardId: string) => void) {}

  private file(id: string) {
    return join(this.dir, `${id}.json`);
  }

  async list(): Promise<{ id: string; name: string }[]> {
    let names: string[] = [];
    try {
      names = (await readdir(this.dir)).filter((f) => f.endsWith(".json"));
    } catch {
      return [];
    }
    const out: { id: string; name: string }[] = [];
    for (const f of names) {
      const id = f.replace(/\.json$/, "");
      if (!BOARD_ID_RE.test(id)) continue;
      const room = await this.rooms.get(id);
      if (room) {
        out.push({ id, name: graphFromDoc(room.doc).name });
        continue;
      }
      const parsed = LooseGraph.safeParse(JSON.parse((await readTextOrNull(this.file(id))) ?? "null"));
      if (parsed.success) out.push({ id, name: parsed.data.name });
    }
    return out.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  }

  async create(id: string, name: string, graph?: Graph): Promise<void> {
    if (!BOARD_ID_RE.test(id)) throw new Error(`invalid board id ${id}`);
    if ((await readTextOrNull(this.file(id))) !== null) throw new Error(`board ${id} exists`);
    const content = graph ? { ...graph, id, name } : emptyGraph(id, name);
    await atomicWrite(this.file(id), `${JSON.stringify(content, null, 2)}\n`);
  }

  /** Put `graph` on a board that has nothing on it yet (the first-run board). False if it has content. */
  async fillIfEmpty(id: string, graph: Graph): Promise<boolean> {
    const room = await this.room(id);
    const current = graphFromDoc(room.doc);
    if (current.nodes.length || current.edges.length) return false;
    loadGraphIntoDoc(room.doc, { ...graph, id });
    return true;
  }

  async exists(id: string): Promise<boolean> {
    return BOARD_ID_RE.test(id) && (this.rooms.has(id) || (await readTextOrNull(this.file(id))) !== null);
  }

  room(id: string): Promise<Room> {
    if (!BOARD_ID_RE.test(id)) return Promise.reject(new Error(`invalid board id ${id}`));
    let r = this.rooms.get(id);
    if (!r) {
      r = this.open(id);
      this.rooms.set(id, r);
      r.catch(() => this.rooms.delete(id));
    }
    return r;
  }

  /** The board as the compiler sees it: straight from the live shared doc. */
  async graph(id: string): Promise<Graph> {
    return graphFromDoc((await this.room(id)).doc);
  }

  private async open(id: string): Promise<Room> {
    const raw = await readTextOrNull(this.file(id));
    if (raw === null) throw new Error(`no board ${id}`);
    const parsed = LooseGraph.safeParse(JSON.parse(raw));
    if (!parsed.success) throw new Error(`boards/${id}.json is not a McBot board: ${parsed.error.issues[0]?.message}`);

    const doc = new Y.Doc();
    loadGraphIntoDoc(doc, { ...parsed.data, id } as Graph);
    const awareness = new awarenessProtocol.Awareness(doc);
    awareness.setLocalState(null); // the relay itself is not a participant
    const room: Room = { id, doc, awareness, conns: new Map(), saveTimer: null, saving: Promise.resolve() };

    doc.on("update", (update: Uint8Array) => {
      const enc = encoding.createEncoder();
      encoding.writeVarUint(enc, MSG_SYNC);
      syncProtocol.writeUpdate(enc, update);
      const msg = encoding.toUint8Array(enc);
      for (const c of room.conns.keys()) send(c, msg);
      this.scheduleSave(room);
    });

    awareness.on("update", ({ added, updated, removed }: { added: number[]; updated: number[]; removed: number[] }, origin: unknown) => {
      const changed = [...added, ...updated, ...removed];
      const ids = room.conns.get(origin as WebSocket);
      if (ids) {
        added.forEach((c) => ids.add(c));
        removed.forEach((c) => ids.delete(c));
      }
      const enc = encoding.createEncoder();
      encoding.writeVarUint(enc, MSG_AWARENESS);
      encoding.writeVarUint8Array(enc, awarenessProtocol.encodeAwarenessUpdate(awareness, changed));
      const msg = encoding.toUint8Array(enc);
      for (const c of room.conns.keys()) send(c, msg);
    });
    return room;
  }

  private scheduleSave(room: Room) {
    if (room.saveTimer) clearTimeout(room.saveTimer);
    room.saveTimer = setTimeout(() => {
      room.saveTimer = null;
      void this.save(room);
    }, 200);
  }

  private save(room: Room): Promise<void> {
    room.saving = room.saving.then(async () => {
      await atomicWrite(this.file(room.id), `${JSON.stringify(graphFromDoc(room.doc), null, 2)}\n`);
      this.onChange?.(room.id);
    });
    return room.saving;
  }

  /**
   * Listeners attach synchronously and buffer until the board is loaded: a
   * y-websocket client sends sync step 1 the moment the socket opens, and a
   * message that arrives before `on("message")` is registered is lost for good.
   */
  async connect(conn: WebSocket, boardId: string): Promise<void> {
    conn.binaryType = "arraybuffer";
    const early: Uint8Array[] = [];
    let handle: ((msg: Uint8Array) => void) | null = null;
    conn.on("message", (data: ArrayBuffer | Buffer) => {
      const msg = data instanceof ArrayBuffer ? new Uint8Array(data) : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
      if (handle) handle(msg);
      else early.push(msg);
    });
    let closedEarly = false;
    conn.once("close", () => (closedEarly = true));

    const room = await this.room(boardId);
    if (closedEarly) return;
    room.conns.set(conn, new Set());

    handle = (msg: Uint8Array) => {
      try {
        const decoder = decoding.createDecoder(msg);
        const enc = encoding.createEncoder();
        switch (decoding.readVarUint(decoder)) {
          case MSG_SYNC:
            encoding.writeVarUint(enc, MSG_SYNC);
            syncProtocol.readSyncMessage(decoder, enc, room.doc, conn);
            if (encoding.length(enc) > 1) send(conn, encoding.toUint8Array(enc));
            break;
          case MSG_AWARENESS:
            awarenessProtocol.applyAwarenessUpdate(room.awareness, decoding.readVarUint8Array(decoder), conn);
            break;
          case MSG_QUERY_AWARENESS:
            encoding.writeVarUint(enc, MSG_AWARENESS);
            encoding.writeVarUint8Array(enc, awarenessProtocol.encodeAwarenessUpdate(room.awareness, [...room.awareness.getStates().keys()]));
            send(conn, encoding.toUint8Array(enc));
            break;
          default:
            break;
        }
      } catch (err) {
        console.error(`[relay] bad message on board ${boardId}:`, err);
      }
    };

    let alive = true;
    conn.on("pong", () => (alive = true));
    const ping = setInterval(() => {
      if (!alive) return conn.terminate();
      alive = false;
      conn.ping();
    }, 30_000);

    conn.on("close", () => {
      clearInterval(ping);
      const ids = room.conns.get(conn);
      room.conns.delete(conn);
      if (ids?.size) awarenessProtocol.removeAwarenessStates(room.awareness, [...ids], null);
    });

    // Sync step 1, then everyone already here.
    const enc = encoding.createEncoder();
    encoding.writeVarUint(enc, MSG_SYNC);
    syncProtocol.writeSyncStep1(enc, room.doc);
    send(conn, encoding.toUint8Array(enc));
    const states = room.awareness.getStates();
    if (states.size) {
      const a = encoding.createEncoder();
      encoding.writeVarUint(a, MSG_AWARENESS);
      encoding.writeVarUint8Array(a, awarenessProtocol.encodeAwarenessUpdate(room.awareness, [...states.keys()]));
      send(conn, encoding.toUint8Array(a));
    }
    for (const msg of early.splice(0)) handle(msg);
  }

  /** Number of live connections per board (for /api/health and the Team tab). */
  async presence(boardId: string): Promise<number> {
    const r = this.rooms.get(boardId);
    return r ? (await r).conns.size : 0;
  }

  async flush(): Promise<void> {
    for (const r of this.rooms.values()) {
      const room = await r;
      if (room.saveTimer) {
        clearTimeout(room.saveTimer);
        room.saveTimer = null;
        await this.save(room);
      }
      await room.saving;
    }
  }
}
