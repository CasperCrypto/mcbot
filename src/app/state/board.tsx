/**
 * The live shared board for this window: one Y.Doc synced through the
 * engine's relay, plus awareness (who is here, their cursor, their selection).
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { WebsocketProvider } from "y-websocket";
import * as Y from "yjs";
import { graphFromDoc } from "../../board/ydoc";
import type { Graph } from "../../contracts/graph";
import { connectDemoBoard, type DemoLink } from "../demo/engine";
import { DEMO, ENGINE_WS } from "../lib/engine";
import { useApp, type Tab } from "./store";

export interface Peer {
  clientId: number;
  name: string;
  color: string;
  cursor: { x: number; y: number } | null;
  selection: string | null;
  tab: Tab | null;
}

/** The board's connection: the engine relay (y-websocket), or the in-page link in the browser demo. */
type Link = DemoLink;

interface Board {
  boardId: string;
  doc: Y.Doc;
  provider: Link;
  graph: Graph;
  peers: Peer[];
  synced: boolean;
  setCursor(p: { x: number; y: number } | null): void;
}

const BoardContext = createContext<Board | null>(null);

export function useBoard(): Board {
  const b = useContext(BoardContext);
  if (!b) throw new Error("useBoard outside <BoardProvider>");
  return b;
}

function useDocGraph(doc: Y.Doc): Graph {
  const cache = useRef<Graph | null>(null);
  const subscribe = useCallback((notify: () => void) => {
    const onUpdate = () => {
      cache.current = null;
      notify();
    };
    doc.on("update", onUpdate);
    return () => doc.off("update", onUpdate);
  }, [doc]);
  return useSyncExternalStore(subscribe, () => (cache.current ??= graphFromDoc(doc)));
}

function readPeers(provider: Link): Peer[] {
  const self = provider.awareness.clientID;
  const out: Peer[] = [];
  provider.awareness.getStates().forEach((s, clientId) => {
    if (clientId === self || !s.user) return;
    out.push({ clientId, name: s.user.name, color: s.user.color, cursor: s.cursor ?? null, selection: s.selection ?? null, tab: s.tab ?? null });
  });
  return out.sort((a, b) => a.clientId - b.clientId);
}

/** Owns the doc + socket. Created in an effect so StrictMode's mount/unmount/mount gets a live one. */
function Connected({ boardId, children }: { boardId: string; children: ReactNode }) {
  const [conn, setConn] = useState<{ doc: Y.Doc; provider: Link } | null>(null);
  useEffect(() => {
    const doc = new Y.Doc();
    // disableBc: every edit must reach the relay, because compile reads the board from it.
    const provider: Link = DEMO ? connectDemoBoard(boardId, doc) : new WebsocketProvider(`${ENGINE_WS}/board`, boardId, doc, { disableBc: true });
    setConn({ doc, provider });
    return () => {
      provider.destroy();
      doc.destroy();
    };
  }, [boardId]);
  if (!conn) return null;
  return <Live key={conn.doc.guid} boardId={boardId} doc={conn.doc} provider={conn.provider}>{children}</Live>;
}

function Live({ boardId, doc, provider, children }: { boardId: string; doc: Y.Doc; provider: Link; children: ReactNode }) {
  const identity = useApp((s) => s.identity);
  const tab = useApp((s) => s.tab);
  const selected = useApp((s) => s.selectedNodeId);
  const graph = useDocGraph(doc);
  const [peers, setPeers] = useState<Peer[]>([]);
  const [synced, setSynced] = useState(provider.synced);

  useEffect(() => {
    const onChange = () => setPeers(readPeers(provider));
    const onSync = (s: boolean) => setSynced(s);
    provider.awareness.on("change", onChange);
    provider.on("sync", onSync);
    setSynced(provider.synced);
    return () => {
      provider.awareness.off("change", onChange);
      provider.off("sync", onSync);
    };
  }, [provider]);

  useEffect(() => {
    provider.awareness.setLocalStateField("user", identity);
  }, [provider, identity]);
  useEffect(() => {
    provider.awareness.setLocalStateField("tab", tab);
  }, [provider, tab]);
  useEffect(() => {
    provider.awareness.setLocalStateField("selection", selected);
  }, [provider, selected]);

  const value = useMemo<Board>(() => ({
    boardId, doc, provider, graph, peers, synced,
    setCursor: (p) => provider.awareness.setLocalStateField("cursor", p),
  }), [boardId, doc, provider, graph, peers, synced]);

  return <BoardContext.Provider value={value}>{children}</BoardContext.Provider>;
}

export function BoardProvider({ children, fallback }: { children: ReactNode; fallback: ReactNode }) {
  const boardId = useApp((s) => s.boardId);
  if (!boardId) return <>{fallback}</>;
  return <Connected key={boardId} boardId={boardId}>{children}</Connected>;
}
