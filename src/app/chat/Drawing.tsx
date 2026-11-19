/**
 * Excalidraw (MIT), loaded only when a drawing is shown: it is the heaviest part of the app, so
 * this module is its own chunk (`lazy(() => import("./Drawing"))`). Its fonts are served by McBot
 * itself (vite.config.ts `excalidrawFonts`), so drawings look the same offline.
 */
import "@excalidraw/excalidraw/index.css";
import { convertToExcalidrawElements, Excalidraw, serializeAsJSON } from "@excalidraw/excalidraw";
import { useMemo } from "react";
import type { Scene } from "./drawing";

declare global {
  interface Window { EXCALIDRAW_ASSET_PATH?: string | string[] }
}
window.EXCALIDRAW_ASSET_PATH = new URL("excalidraw/", document.baseURI).href;

type Api = Parameters<NonNullable<Parameters<typeof Excalidraw>[0]["excalidrawAPI"]>>[0];

/** What the sheet keeps to save: the scene as an Excalidraw file. */
export interface DrawingHandle { json(): string }

export default function DrawingCanvas({ scene, edit, onReady }: { scene: Scene; edit: boolean; onReady?: (h: DrawingHandle) => void }) {
  const elements = useMemo(() => {
    try {
      return scene.skeleton ? convertToExcalidrawElements(scene.elements as never, { regenerateIds: false }) : (scene.elements as never[]);
    } catch {
      return [];
    }
  }, [scene]);
  return (
    <Excalidraw
      theme="dark"
      viewModeEnabled={!edit}
      zenModeEnabled={!edit}
      gridModeEnabled={false}
      initialData={{ elements, files: scene.files as never, appState: { viewBackgroundColor: "transparent", currentItemFontFamily: 5 }, scrollToContent: true }}
      UIOptions={{ canvasActions: { loadScene: false, saveToActiveFile: false, toggleTheme: false, changeViewBackgroundColor: edit, export: false, saveAsImage: edit, clearCanvas: edit } }}
      excalidrawAPI={(api: Api) => {
        // The whole drawing in view: inline it fills its box, full size it leaves room around it.
        requestAnimationFrame(() => api.scrollToContent(undefined, { fitToViewport: true, viewportZoomFactor: edit ? 0.7 : 0.9, animate: false }));
        onReady?.({ json: () => serializeAsJSON(api.getSceneElements(), api.getAppState(), api.getFiles(), "local") });
      }}
    />
  );
}
