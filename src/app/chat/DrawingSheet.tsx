/**
 * Drawings: inline in an answer (view only, `DrawingBlock`) and full size to edit (`DrawingSheet`).
 * A drawing from a file saves back over the sha256 it was read with; one from an answer saves into
 * the shared files folder as `drawings/<name>.excalidraw`. Excalidraw itself loads on first use.
 */
import { Maximize2, PenLine, X } from "lucide-react";
import { lazy, Suspense, useRef, useState } from "react";
import { DEMO, engine, REMOTE } from "../lib/engine";
import { useLingering, usePresence } from "../lib/presence";
import { useApp } from "../state/store";
import type { DrawingHandle } from "./DrawingCanvas";
import { drawingFileName, type Scene } from "./drawing";

const DrawingCanvas = lazy(() => import("./DrawingCanvas"));

const Placeholder = () => <div className="drawing-wait skeleton" aria-hidden />;

/** A drawing inside an answer: the scene, view only, with Open to edit it full size. */
export function DrawingBlock({ scene, onOpen }: { scene: Scene; onOpen?: () => void }) {
  const open = onOpen ?? (() => useApp.getState().openDrawing({ scene, title: "Drawing" }));
  return (
    <figure className="rich-drawing" data-testid="rich-drawing">
      <div className="rich-drawing-canvas">
        <Suspense fallback={<Placeholder />}><DrawingCanvas scene={scene} edit={false} /></Suspense>
      </div>
      <button className="btn sm rich-drawing-open" onClick={open} data-tip="Open to edit"><Maximize2 size={13} /> Open</button>
    </figure>
  );
}

export function DrawingSheet() {
  const drawing = useApp((s) => s.drawing);
  const shown = useLingering(drawing).value;
  const presence = usePresence(!!drawing);
  const handle = useRef<DrawingHandle | null>(null);
  const [saving, setSaving] = useState(false);
  const close = () => useApp.getState().openDrawing(null);
  // No Esc or outside click: Esc belongs to Excalidraw (deselect), and a stray click must not lose a drawing.
  if (!presence.mounted || !shown) return null;
  const canSave = !DEMO && !REMOTE;

  const save = async () => {
    const json = handle.current?.json();
    if (!json || saving) return;
    setSaving(true);
    const app = useApp.getState();
    try {
      if (shown.file) {
        const r = await engine.writeFile(shown.file.root, shown.file.path, json, shown.file.sha256);
        app.openDrawing({ ...shown, file: { ...shown.file, sha256: r.sha256 } });
        app.toast({ kind: "ok", text: `Saved ${shown.file.path}` });
      } else {
        // A new file: never over one already there (the engine refuses that with 409), so step the name.
        const base = drawingFileName(shown.scene);
        let path = base;
        let r: { sha256: string } | null = null;
        for (let n = 2; !r; n++) {
          try {
            r = await engine.writeFile("workspace:files", path, json, null);
          } catch (e) {
            if (n > 20 || !/changed since/.test((e as Error).message)) throw e;
            path = base.replace(/\.excalidraw$/, `-${n}.excalidraw`);
          }
        }
        app.openDrawing({ ...shown, title: path, file: { root: "workspace:files", path, sha256: r.sha256 } });
        app.toast({ kind: "ok", text: `Saved to Files · ${path}` });
      }
    } catch (e) {
      app.toast({ kind: "fail", text: `Couldn't save the drawing: ${(e as Error).message}` });
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <div className="palette-scrim" data-closing={presence.closing || undefined} />
      <section className="drawing-sheet glass" role="dialog" aria-modal="true" aria-label={shown.title} data-closing={presence.closing || undefined} data-testid="drawing-sheet">
        <header>
          <span className="hermes-mark" aria-hidden><PenLine size={16} /></span>
          <b className="grow ellipsis">{shown.title}</b>
          {canSave && <button className="btn primary sm" disabled={saving} onClick={() => void save()} data-testid="drawing-save">{saving ? "Saving…" : shown.file ? "Save" : "Save to Files"}</button>}
          <button className="icon-btn" aria-label="Close" onClick={close}><X size={15} /></button>
        </header>
        <div className="drawing-sheet-canvas">
          <Suspense fallback={<Placeholder />}>
            <DrawingCanvas key={shown.file?.path ?? "answer"} scene={shown.scene} edit onReady={(h) => { handle.current = h; }} />
          </Suspense>
        </div>
      </section>
    </>
  );
}
