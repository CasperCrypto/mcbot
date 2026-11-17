import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const engine = `http://127.0.0.1:${process.env.MCBOT_PORT ?? 4317}`;
/**
 * `npm run build:demo` (`vite build --mode demo`, so it runs the same on Windows, where `VAR=1 cmd`
 * is not a command): the browser-only demo, a relative-path bundle with fonts inlined, no source maps.
 * VITE_MCBOT_DEMO=1 still works.
 */
export default defineConfig(({ mode }) => {
  const demo = mode === "demo" || process.env.VITE_MCBOT_DEMO === "1";
  return {
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
  define: demo ? { "import.meta.env.VITE_MCBOT_DEMO": JSON.stringify("1") } : {},
  };
});
