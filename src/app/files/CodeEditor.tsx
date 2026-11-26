/**
 * The Files view's editor: Monaco (MIT), its own lazy chunk, so the view opens without it and it
 * loads with the first text file. One editor; every open file is a Monaco model it keeps, so each
 * file keeps its undo, cursor and unsaved changes while another is shown. The view owns what is on
 * disk (`EditorDoc.text`, `version` bumped after each save or reload) and asks the editor for what is
 * typed through the handle.
 */
import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { useApp } from "../state/store";
import { applyMonacoTheme, languageOf, monaco } from "../workbench/monaco";

export interface EditorDoc {
  key: string;
  path: string;
  /** What is on disk, as last read or saved. */
  text: string;
  readOnly: boolean;
  /** Bumped when `text` is new from disk (a save, a reload). */
  version: number;
}

export interface EditorHandle {
  /** What the editor holds for a file now (saved or not). */
  value(key: string): string | null;
  /** The selection in the file shown, with its first and last line; null when nothing is selected. */
  selection(): { text: string; from: number; to: number } | null;
  language(key: string): string;
}

interface Kept {
  model: monaco.editor.ITextModel;
  saved: string;
  version: number;
  view: monaco.editor.ICodeEditorViewState | null;
}

const CodeEditor = forwardRef<EditorHandle, {
  docs: readonly EditorDoc[];
  active: string | null;
  /** Unsaved text per file: read when a file's model is made, written back when the editor goes (another view opens). */
  drafts: Map<string, string>;
  onDirty: (key: string, dirty: boolean) => void;
}>(function CodeEditor({ docs, active, drafts, onDirty }, ref) {
  const host = useRef<HTMLDivElement>(null);
  const editor = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const kept = useRef(new Map<string, Kept>());
  const shown = useRef<string | null>(null);
  const handlers = useRef({ onDirty });
  handlers.current = { onDirty };

  useImperativeHandle(ref, () => ({
    value: (key) => kept.current.get(key)?.model.getValue() ?? null,
    selection: () => {
      const sel = editor.current?.getSelection();
      const model = editor.current?.getModel();
      if (!sel || sel.isEmpty() || !model) return null;
      return { text: model.getValueInRange(sel), from: sel.startLineNumber, to: sel.endLineNumber };
    },
    language: (key) => kept.current.get(key)?.model.getLanguageId() ?? "plaintext",
  }), []);

  // The cursor and selection follow the accent.
  const accent = useApp((s) => s.appearance.accent);
  useEffect(() => {
    applyMonacoTheme();
  }, [accent]);

  useEffect(() => {
    if (!host.current) return undefined;
    const ed = monaco.editor.create(host.current, {
      theme: "mcbot", automaticLayout: true, minimap: { enabled: false }, fontSize: 14,
      fontFamily: getComputedStyle(document.documentElement).getPropertyValue("--mono"),
      scrollBeyondLastLine: false, padding: { top: 12 }, renderLineHighlight: "line", smoothScrolling: true, wordWrap: "on",
    });
    editor.current = ed;
    const models = kept.current;
    return () => {
      // What isn't saved waits for the editor's return.
      for (const [key, k] of models) {
        const now = k.model.getValue();
        if (now !== k.saved) drafts.set(key, now);
        else drafts.delete(key);
        k.model.dispose();
      }
      models.clear();
      ed.dispose();
      editor.current = null;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Models follow the open files: new ones are made, closed ones go, new text from disk comes in.
  useEffect(() => {
    const map = kept.current;
    for (const d of docs) {
      const k = map.get(d.key);
      if (!k) {
        const draft = drafts.get(d.key);
        const model = monaco.editor.createModel(draft ?? d.text, languageOf(d.path));
        const entry: Kept = { model, saved: d.text, version: d.version, view: null };
        model.onDidChangeContent(() => handlers.current.onDirty(d.key, model.getValue() !== entry.saved));
        map.set(d.key, entry);
        if (draft !== undefined && draft !== d.text) handlers.current.onDirty(d.key, true);
      } else if (k.version !== d.version) {
        k.version = d.version;
        k.saved = d.text;
        if (k.model.getValue() !== d.text) k.model.setValue(d.text);
        handlers.current.onDirty(d.key, false);
      }
    }
    for (const [key, k] of map) {
      if (docs.some((d) => d.key === key)) continue;
      if (editor.current?.getModel() === k.model) editor.current.setModel(null);
      k.model.dispose();
      map.delete(key);
    }
  }, [docs]);

  // The file shown: each keeps where its cursor and scroll were.
  useEffect(() => {
    const ed = editor.current;
    if (!ed) return;
    const now = active ? kept.current.get(active) : undefined;
    if (shown.current !== active || ed.getModel() !== (now?.model ?? null)) {
      const was = shown.current ? kept.current.get(shown.current) : undefined;
      if (was && was.model === ed.getModel()) was.view = ed.saveViewState();
      ed.setModel(now?.model ?? null);
      if (now?.view) ed.restoreViewState(now.view);
      shown.current = active;
      if (now) ed.focus();
    }
    ed.updateOptions({ readOnly: docs.find((d) => d.key === active)?.readOnly ?? true });
  }, [active, docs]);

  return <div ref={host} className="monaco-host" data-testid="editor" />;
});

export default CodeEditor;
