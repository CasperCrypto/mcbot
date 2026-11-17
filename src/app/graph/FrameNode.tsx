/**
 * A frame on the board: a titled, coloured area that groups blocks ("Research", "Support").
 * Drag it by its title to move it with everything inside (GraphView moves the members);
 * resize it from its edges; click the title to rename. Never compiled.
 */
import { NodeResizer, type Node, type NodeProps } from "@xyflow/react";
import { X } from "lucide-react";
import { memo, useState } from "react";
import { removeFrame, setFrameField } from "../../board/ydoc";
import { NOTE_COLORS, type Frame } from "../../contracts/graph";
import { useBoard } from "../state/board";

export const FrameNodeView = memo(function FrameNodeView({ data, selected }: NodeProps<Node<{ frame: Frame }>>) {
  const { doc } = useBoard();
  const f = data.frame;
  const [editing, setEditing] = useState(!f.title);
  const next = NOTE_COLORS[(NOTE_COLORS.indexOf(f.color) + 1) % NOTE_COLORS.length]!;
  return (
    <div className="board-frame" data-color={f.color} data-testid={`frame-${f.id}`}>
      <NodeResizer isVisible={selected} minWidth={160} minHeight={100} lineClassName="frame-resize-line" handleClassName="frame-resize-handle"
        onResizeEnd={(_, p) => {
          setFrameField(doc, f.id, "position", { x: Math.round(p.x), y: Math.round(p.y) });
          setFrameField(doc, f.id, "size", { width: Math.round(p.width), height: Math.round(p.height) });
        }} />
      <div className="frame-head">
        {editing ? (
          <input className="nodrag" autoFocus defaultValue={f.title} placeholder="Name this frame" aria-label="Frame name" maxLength={120}
            onBlur={(e) => { setFrameField(doc, f.id, "title", e.target.value.trim()); setEditing(false); }}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === "Escape") (e.target as HTMLInputElement).blur(); e.stopPropagation(); }} />
        ) : (
          <span className="frame-title" onClick={() => setEditing(true)} data-tip="Rename">{f.title || "Untitled"}</span>
        )}
        <button className="frame-dot nodrag" aria-label="Change colour" data-tip="Colour" onClick={() => setFrameField(doc, f.id, "color", next)} />
        <button className="frame-x nodrag" aria-label="Remove frame" data-tip="Remove the frame (its blocks stay)" onClick={() => removeFrame(doc, f.id)}><X size={11} /></button>
      </div>
    </div>
  );
});
