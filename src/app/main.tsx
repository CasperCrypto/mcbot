import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { IslandPill } from "./shell/IslandPill";
import "./styles/index.css";

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

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {pill ? <IslandPill /> : <App />}
  </StrictMode>,
);
