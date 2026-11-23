import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { IslandPill } from "./shell/IslandPill";
import "./styles/index.css";
import { applyAppearance, loadAppearance, onAppearanceElsewhere, onSystemTheme } from "./lib/appearance";
import { useApp } from "./state/store";

// In the macOS app the title bar is an overlay: leave room for the traffic lights.
if ("__TAURI_INTERNALS__" in window) document.documentElement.dataset.shell = /Mac/.test(navigator.userAgent) ? "mac" : "win";

// A tooltip steps aside once its control is clicked, until the pointer leaves it (as on macOS).
document.addEventListener("pointerdown", (e) => {
  const el = (e.target as Element | null)?.closest?.("[data-tip]");
  if (!el || el.hasAttribute("data-tip-off")) return;
  el.setAttribute("data-tip-off", "");
  el.addEventListener("pointerleave", () => el.removeAttribute("data-tip-off"), { once: true });
}, true);

// The shell's floating island is its own small window with its own page (label `island`).
const meta = (window as unknown as { __TAURI_INTERNALS__?: { metadata?: { currentWindow?: { label?: string } } } }).__TAURI_INTERNALS__;
const pill = meta?.metadata?.currentWindow?.label === "island";
if (pill) document.documentElement.dataset.island = "";

// Light, dark or the system's, before the first paint; then follow the system and the other
// windows. The floating pill is black and see-through around it, so it keeps its own look.
if (!pill) {
  applyAppearance(loadAppearance());
  useApp.getState().syncAppearance();
  onSystemTheme(() => { if (useApp.getState().appearance.theme === "system") useApp.getState().syncAppearance(); });
  onAppearanceElsewhere((a) => useApp.getState().syncAppearance(a));
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {pill ? <IslandPill /> : <App />}
  </StrictMode>,
);
