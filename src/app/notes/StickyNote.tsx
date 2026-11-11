import { Pin, PinOff, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { removeNote, setNoteField } from "../../board/ydoc";
import { NOTE_COLORS, type Note } from "../../contracts/graph";
import { ago } from "../lib/format";
import { useBoard } from "../state/board";
import { useApp } from "../state/store";

/**
 * One sticky note, on Home or on the canvas. Text saves to the shared board as you type
 * (debounced), so everyone on the board sees it; colour, pin and delete are on hover.
 */
export function StickyNote({ note, canvas = false }: { note: Note; canvas?: boolean }) {
  const { doc } = useBoard();
  const autoFocus = useApp((s) => s.freshNote === note.id);
  const [text, setText] = useState(note.text);
  const typing = useRef<ReturnType<typeof setTimeout> | null>(null);
  const focused = useRef(false);
  // Someone else's edit arrives while this note is not being typed in.
  useEffect(() => {
    if (!focused.current) setText(note.text);
  }, [note.text]);
  useEffect(() => () => { if (typing.current) clearTimeout(typing.current); }, []);
  // A note this window just made opens ready to type (on the canvas it appears a frame later).
  const area = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (!autoFocus) return;
    const t = setTimeout(() => area.current?.focus(), 60);
    return () => clearTimeout(t);
  }, [autoFocus]);
  const change = (v: string) => {
    setText(v);
    if (typing.current) clearTimeout(typing.current);
    typing.current = setTimeout(() => setNoteField(doc, note.id, "text", v), 250);
  };
  return (
    <div className={`sticky note-${note.color}${canvas ? " on-canvas" : ""}`} data-testid="sticky-note">
      <textarea
        className="nodrag nowheel"
        ref={area}
        autoFocus={autoFocus}
        value={text}
        placeholder="Write a note…"
        aria-label="Note"
        onChange={(e) => change(e.target.value)}
        onFocus={() => {
          focused.current = true;
          if (autoFocus) useApp.getState().setFreshNote(null);
        }}
        onBlur={() => {
          focused.current = false;
          if (typing.current) clearTimeout(typing.current);
          if (text !== note.text) setNoteField(doc, note.id, "text", text);
        }}
      />
      <div className="sticky-foot nodrag">
        <span className="sticky-by">{[note.author, note.at ? ago(note.at) : ""].filter(Boolean).join(" · ")}</span>
        <span className="sticky-tools">
          {NOTE_COLORS.map((c) => (
            <button key={c} className={`sticky-color note-${c}`} aria-label={`${c} note`} aria-pressed={note.color === c} onClick={() => setNoteField(doc, note.id, "color", c)} />
          ))}
          <button className="sticky-btn" aria-label={note.pinned ? "Unpin from Home" : "Pin to Home"} data-tip={note.pinned ? "Unpin from Home" : "Pin to Home"} onClick={() => setNoteField(doc, note.id, "pinned", !note.pinned)}>
            {note.pinned ? <PinOff size={12} /> : <Pin size={12} />}
          </button>
          <button className="sticky-btn" aria-label="Delete note" data-tip="Delete" onClick={() => removeNote(doc, note.id)}><Trash2 size={12} /></button>
        </span>
      </div>
      {note.pinned && <Pin size={12} className="sticky-pin" />}
    </div>
  );
}
