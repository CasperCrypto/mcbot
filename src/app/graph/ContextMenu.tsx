/**
 * Right-click on the board: on empty space, add a block right there; on a block, its actions.
 * A glass menu at the pointer; a click elsewhere or Esc closes it (lib/presence.ts).
 */
import { Bot, Cloud, Copy, FileCode2, FolderOpen, HardDrive, Maximize, MessagesSquare, PanelRight, Plug, StickyNote, Trash2 } from "lucide-react";
import { useCallback, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { addNode, addNote, removeNodes } from "../../board/ydoc";
import type { GraphNode } from "../../contracts/graph";
import { useDismiss } from "../lib/presence";
import { useBoard } from "../state/board";
import { useApp } from "../state/store";
import { duplicateNode, newAgent, newId, newModel, newTool } from "./defaults";

export type MenuAt = { x: number; y: number; flow: { x: number; y: number }; nodeId: string | null };

function Item({ icon, label, keys, danger, onClick }: { icon: ReactNode; label: string; keys?: string; danger?: boolean; onClick: () => void }) {
  return (
    <button role="menuitem" className={danger ? "danger" : undefined} onClick={onClick}>
      {icon}<span className="grow">{label}</span>{keys && <span className="menu-keys">{keys}</span>}
    </button>
  );
}

export function ContextMenu({ at, onClose, onFit }: { at: MenuAt; onClose: () => void; onFit: () => void }) {
  const { graph, doc } = useBoard();
  const app = useApp();
  const ref = useRef<HTMLDivElement>(null);
  const close = useCallback(() => onClose(), [onClose]);
  useDismiss(true, close, ref);
  // Keep it on screen near the window's edges.
  const [pos, setPos] = useState({ left: at.x, top: at.y });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    // offsetWidth/Height: its real size, not the one its pop-in animation is scaling.
    setPos({ left: Math.min(at.x, window.innerWidth - el.offsetWidth - 8), top: Math.min(at.y, window.innerHeight - el.offsetHeight - 8) });
  }, [at]);

  const node = at.nodeId ? graph.nodes.find((n) => n.id === at.nodeId) ?? null : null;
  const run = (fn: () => void) => () => { fn(); close(); };
  const place = (n: GraphNode) => { addNode(doc, n); app.select(n.id); };
  const spot = { x: Math.round(at.flow.x), y: Math.round(at.flow.y) };

  // On the page itself: the board's view animates with a transform, which would carry a fixed menu off the pointer.
  return createPortal(
    <div ref={ref} className="menu context-menu" role="menu" style={pos} data-testid="context-menu" onContextMenu={(e) => e.preventDefault()}>
      {node ? (
        <>
          <Item icon={<PanelRight size={14} />} label="Open" onClick={run(() => app.select(node.id))} />
          {node.kind === "agent" && <Item icon={<MessagesSquare size={14} />} label="Chat" onClick={run(() => app.openChat(node.id))} />}
          {node.kind === "agent" && <Item icon={<FileCode2 size={14} />} label="Its files" onClick={run(() => { app.select(node.id); app.setLiveFilesOpen(true); })} />}
          <Item icon={<Copy size={14} />} label="Duplicate" keys="⌘D" onClick={run(() => place(duplicateNode(graph, node)))} />
          <hr />
          <Item icon={<Trash2 size={14} />} label="Delete" keys="⌫" danger onClick={run(() => { removeNodes(doc, [node.id]); app.select(null); })} />
        </>
      ) : (
        <>
          <Item icon={<Bot size={14} />} label="Agent" onClick={run(() => place(newAgent(graph, spot)))} />
          <Item icon={<HardDrive size={14} />} label="Local model" onClick={run(() => place(newModel(graph, "local", spot)))} />
          <Item icon={<Cloud size={14} />} label="Cloud model" onClick={run(() => place(newModel(graph, "cloud", spot)))} />
          <Item icon={<FolderOpen size={14} />} label="Files tool" onClick={run(() => place(newTool(graph, "filesystem", spot, app.health?.workspace ?? null)))} />
          <Item icon={<Plug size={14} />} label="Tool…" onClick={run(() => app.setCatalogOpen(true))} />
          <Item icon={<StickyNote size={14} />} label="Sticky note" onClick={run(() => {
            const id = newId("note");
            addNote(doc, { id, text: "", color: "yellow", position: spot, pinned: false, author: app.identity.name, at: Date.now() });
            app.setFreshNote(id);
          })} />
          <hr />
          <Item icon={<Maximize size={14} />} label="Fit the board" keys="⌘0" onClick={run(onFit)} />
        </>
      )}
    </div>,
    document.body,
  );
}
