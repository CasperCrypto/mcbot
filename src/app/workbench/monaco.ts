/**
 * Monaco (MIT, the VS Code editor), bundled: no CDN, works offline. Loaded only when the Code
 * view opens. Its language workers come from the bundle too (Vite `?worker`).
 */
import * as monaco from "monaco-editor";
import EditorWorker from "monaco-editor/editor/editor.worker?worker";
import CssWorker from "monaco-editor/language/css/css.worker?worker";
import HtmlWorker from "monaco-editor/language/html/html.worker?worker";
import JsonWorker from "monaco-editor/language/json/json.worker?worker";
import TsWorker from "monaco-editor/language/typescript/ts.worker?worker";

self.MonacoEnvironment = {
  getWorker(_id: string, label: string) {
    if (label === "json") return new JsonWorker();
    if (label === "css" || label === "scss" || label === "less") return new CssWorker();
    if (label === "html" || label === "handlebars" || label === "razor") return new HtmlWorker();
    if (label === "typescript" || label === "javascript") return new TsWorker();
    return new EditorWorker();
  },
};

/** McBot's dark look, from the same values as tokens.css (Monaco needs hex, not CSS variables). */
const css = (name: string, fallback: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
monaco.editor.defineTheme("mcbot", {
  base: "vs-dark",
  inherit: true,
  rules: [],
  colors: {
    "editor.background": css("--bg-main", "#1c1c1e"),
    "editor.lineHighlightBackground": "#ffffff08",
    "editorLineNumber.foreground": css("--text-4", "#5c5c64"),
    "editorLineNumber.activeForeground": css("--text-2", "#b4b4ba"),
    "editor.selectionBackground": "#0a84ff55",
    "editorCursor.foreground": css("--accent", "#0a84ff"),
    "editorWidget.background": css("--bg-raised", "#222225"),
  },
});

/** Monaco's language for a file name. */
export function languageOf(path: string): string {
  const name = path.split("/").pop()!.toLowerCase();
  const ext = name.includes(".") ? name.slice(name.lastIndexOf(".")) : name;
  const lang = monaco.languages.getLanguages().find((l) => l.extensions?.includes(ext) || l.filenames?.map((f) => f.toLowerCase()).includes(name));
  return lang?.id ?? "plaintext";
}

export { monaco };
