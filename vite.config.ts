import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const engine = `http://127.0.0.1:${process.env.MCBOT_PORT ?? 4317}`;

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
  build: { target: "es2022", outDir: "dist", sourcemap: true },
});
