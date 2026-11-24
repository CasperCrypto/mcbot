import react from "@vitejs/plugin-react";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { defineConfig, type Plugin } from "vite";

/**
 * Excalidraw's hand-drawn fonts, served from McBot itself as `excalidraw/fonts/…` (the app's CSP
 * allows fonts from 'self' only, and a desktop app must draw offline). Its CJK font (13 MB) is left
 * to Excalidraw's own fallback.
 */
function excalidrawFonts(): Plugin {
  const dir = join("node_modules", "@excalidraw", "excalidraw", "dist", "prod", "fonts");
  const files = (): string[] => !existsSync(dir) ? [] : readdirSync(dir).filter((f) => f !== "Xiaolai").flatMap((f) => statSync(join(dir, f)).isDirectory() ? readdirSync(join(dir, f)).map((x) => `${f}/${x}`) : []);
  return {
    name: "mcbot-excalidraw-fonts",
    configureServer(server) {
      server.middlewares.use("/excalidraw/fonts/", (req, res, next) => {
        const name = decodeURIComponent((req.url ?? "").split("?")[0]!.replace(/^\/+/, ""));
        if (!files().includes(name)) return next();
        res.setHeader("Content-Type", "font/woff2");
        res.end(readFileSync(join(dir, name)));
      });
    },
    generateBundle() {
      for (const f of files()) this.emitFile({ type: "asset", fileName: `excalidraw/fonts/${f}`, source: readFileSync(join(dir, f)) });
    },
  };
}

const engine = `http://127.0.0.1:${process.env.MCBOT_PORT ?? 4317}`;
/**
 * `npm run build:demo` (`vite build --mode demo`, so it runs the same on Windows, where `VAR=1 cmd`
 * is not a command): the browser-only demo, a relative-path bundle with fonts inlined, no source maps.
 * VITE_MCBOT_DEMO=1 still works.
 */
export default defineConfig(({ mode }) => {
  const demo = mode === "demo" || process.env.VITE_MCBOT_DEMO === "1";
  return {
  plugins: [react(), excalidrawFonts()],
  clearScreen: false,
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      "/api": { target: engine, changeOrigin: true },
      "/board": { target: engine.replace("http", "ws"), ws: true, changeOrigin: true },
    },
  },
  envPrefix: ["VITE_", "TAURI_ENV_"],
  // A desktop app loads its bundle from disk, so the web-oriented 500 kB chunk warning does not apply.
  base: demo ? "./" : "/",
  build: demo
    ? { target: "es2022", outDir: "dist-demo", sourcemap: false, assetsInlineLimit: 1_000_000, chunkSizeWarningLimit: 2000 }
    // No source maps in what ships (they were 69 MB of the app); MCBOT_SOURCEMAP=1 makes them.
    : { target: "es2022", outDir: "dist", sourcemap: process.env.MCBOT_SOURCEMAP === "1", chunkSizeWarningLimit: 2000 },
  define: demo ? { "import.meta.env.VITE_MCBOT_DEMO": JSON.stringify("1") } : {},
  };
});
