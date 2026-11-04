import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const engine = `http://127.0.0.1:${process.env.MCBOT_PORT ?? 4317}`;
/** `npm run build:demo`: the browser-only demo, a relative-path bundle with fonts inlined, no source maps. */
const demo = process.env.VITE_MCBOT_DEMO === "1";

export default defineConfig({
  plugins: [react()],
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
    : { target: "es2022", outDir: "dist", sourcemap: true, chunkSizeWarningLimit: 2000 },
});
