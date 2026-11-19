/**
 * Drawings agents make: an Excalidraw scene, from a ```excalidraw block in an answer or a
 * `.excalidraw` file. Pure (text in, scene out); `chat/Drawing.tsx` draws it, loaded only when one
 * is shown.
 *
 * Accepted: Excalidraw's own file (`{"type":"excalidraw","elements":[…]}`), a bare array of
 * elements, or `{"elements":[…]}`. Elements may be full Excalidraw elements or its short "skeleton"
 * form (`{"type":"rectangle","x":0,"y":0,"label":{"text":"Planner"}}`, arrows with `start`/`end`
 * ids), which models write far more reliably; `skeleton` says which.
 */
export interface Scene {
  elements: Record<string, unknown>[];
  files: Record<string, unknown>;
  skeleton: boolean;
}

const KINDS = new Set(["rectangle", "ellipse", "diamond", "arrow", "line", "text", "freedraw", "image", "frame", "magicframe", "embeddable", "iframe", "selection"]);
const MAX = 2000;

export function parseDrawing(text: string): Scene | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  const obj = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null;
  const list = Array.isArray(raw) ? raw : Array.isArray(obj?.elements) ? (obj!.elements as unknown[]) : null;
  if (!list) return null;
  const elements = list
    .filter((e): e is Record<string, unknown> => !!e && typeof e === "object" && !Array.isArray(e) && KINDS.has(String((e as Record<string, unknown>).type)))
    .filter((e) => !e.isDeleted)
    .slice(0, MAX);
  if (elements.length === 0) return null;
  const files = obj?.files && typeof obj.files === "object" && !Array.isArray(obj.files) ? (obj.files as Record<string, unknown>) : {};
  // A full element carries Excalidraw's bookkeeping; the skeleton form leaves it out.
  const skeleton = elements.some((e) => typeof e.seed !== "number" || typeof e.version !== "number");
  return { elements, files, skeleton };
}

/** A `.excalidraw` file name, for the Files view and "Save to Files". */
export const isDrawingFile = (path: string): boolean => /\.excalidraw(\.json)?$/i.test(path);

/** A file name for a drawing from its first text, e.g. "drawings/research-flow.excalidraw". */
export function drawingFileName(scene: Scene, now = new Date()): string {
  const first = scene.elements.map((e) => (typeof e.text === "string" ? e.text : (e.label as { text?: unknown } | undefined)?.text)).find((t): t is string => typeof t === "string" && t.trim().length > 0);
  const slug = (first ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
  return `drawings/${slug || `drawing-${now.toISOString().slice(0, 10)}`}.excalidraw`;
}
