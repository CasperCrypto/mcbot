/**
 * A file that isn't edited as text, shown as itself: a picture, a video, a sound (streamed by the
 * engine as a blob, `GET /api/fs/raw`), a drawing on Excalidraw's canvas, or, for anything else (a
 * PDF, a spreadsheet), its name and size with Show in Finder.
 */
import { FileQuestion, FolderSearch } from "lucide-react";
import { useEffect, useState } from "react";
import type { FsPreview, FsRoot } from "../../contracts/api";
import { DrawingBlock } from "../chat/DrawingSheet";
import { parseDrawing } from "../chat/drawing";
import { engine } from "../lib/engine";
import { bytes } from "../lib/format";
import { canReveal, revealFile, revealLabel } from "../lib/open";
import { useApp } from "../state/store";
import { SkeletonCards } from "../ui";
import { absolute, baseName, extOf, type Shown } from "./paths";

export function Preview({ root, path, shown, size, reason }: { root: FsRoot; path: string; shown: Exclude<Shown, "text">; size: number | null; reason?: string | null }) {
  if (shown === "image" || shown === "video" || shown === "audio") return <Media root={root} path={path} shown={shown} />;
  if (shown === "drawing") return <Drawing root={root} path={path} />;
  return <Other root={root} path={path} size={size} reason={reason ?? null} />;
}

function Media({ root, path, shown }: { root: FsRoot; path: string; shown: "image" | "video" | "audio" }) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    let made: string | null = null;
    setUrl(null);
    setError(null);
    engine.rawFile(root.id, path).then((b) => {
      if (!live) return;
      made = URL.createObjectURL(b);
      setUrl(made);
    }).catch((e: unknown) => { if (live) setError((e as Error).message); });
    return () => {
      live = false;
      if (made) URL.revokeObjectURL(made);
    };
  }, [root.id, path]);
  if (error) return <Other root={root} path={path} size={null} reason={error} />;
  if (!url) return <div className="file-preview"><SkeletonCards count={1} /></div>;
  return (
    <div className={`file-preview ${shown}`} data-testid="file-preview">
      {shown === "image" ? <img src={url} alt={baseName(path)} draggable={false} />
        : shown === "video" ? <video src={url} controls playsInline />
          : <audio src={url} controls />}
    </div>
  );
}

function Drawing({ root, path }: { root: FsRoot; path: string }) {
  const [file, setFile] = useState<FsPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    setFile(null);
    engine.read(root.id, path).then((f) => { if (live) setFile(f); }).catch((e: unknown) => { if (live) setError((e as Error).message); });
    return () => { live = false; };
  }, [root.id, path]);
  const scene = file?.text ? parseDrawing(file.text) : null;
  if (error || (file && !scene)) return <Other root={root} path={path} size={file?.bytes ?? null} reason={error ?? "This drawing can't be read"} />;
  if (!file || !scene) return <div className="file-preview"><SkeletonCards count={1} /></div>;
  return (
    <div className="file-preview drawing" data-testid="file-preview">
      <DrawingBlock scene={scene} onOpen={() => useApp.getState().openDrawing({ scene, title: path, file: { root: root.id, path, sha256: file.sha256 ?? null } })} />
    </div>
  );
}

function Other({ root, path, size, reason }: { root: FsRoot; path: string; size: number | null; reason: string | null }) {
  const ext = extOf(path).slice(0, 4);
  return (
    <div className="file-preview other" data-testid="file-preview">
      <div className="file-card">
        {ext ? <span className={`ext big ${ext}`}>{ext}</span> : <span className="tile"><FileQuestion size={18} /></span>}
        <b className="ellipsis">{baseName(path)}</b>
        <span className="faint">{reason ?? (size !== null ? bytes(size) : "")}</span>
        {canReveal() && <button className="btn sm" onClick={() => void revealFile(absolute(root, path))}><FolderSearch size={13} /> {revealLabel()}</button>}
      </div>
    </div>
  );
}
