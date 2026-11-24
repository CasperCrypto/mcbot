import { StrictMode } from "react";
import { LucideProvider } from "lucide-react";
import { createRoot } from "react-dom/client";
import { useEffect, useState } from "react";
import { App } from "./App";
import { IslandPill } from "./shell/IslandPill";
import { GuestChat } from "./shell/GuestChat";
import { WebJoin } from "./shell/WebJoin";
import { DEMO, REMOTE } from "./lib/engine";
import "./styles/index.css";
import { onAppearanceElsewhere } from "./lib/appearance";
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

// The accent colour, before the first paint; then follow the other windows. The floating pill
// is black and see-through around it, so it keeps its own look.
if (!pill) {
  useApp.getState().syncAppearance();
  onAppearanceElsewhere((a) => useApp.getState().syncAppearance(a));
}

/**
 * Which page this is. The app, its floating pill, or (opened from a Share link in a web browser,
 * served by the computer that shares) the join page, then a guest's chat or the app.
 */
const inBrowser = !("__TAURI_INTERNALS__" in window) && !DEMO;
function Root() {
  const joinPage = inBrowser && location.pathname === "/join";
  // A browser on someone's share port with no key yet: the join page (it asks for the link).
  const [onSharePort, setOnSharePort] = useState<boolean | null>(inBrowser && !REMOTE && !joinPage ? null : false);
  useEffect(() => {
    if (onSharePort !== null) return;
    fetch("/api/share/hello").then((r) => setOnSharePort(r.ok)).catch(() => setOnSharePort(false));
  }, [onSharePort]);
  if (pill) return <IslandPill />;
  if (joinPage || onSharePort) return <WebJoin />;
  if (onSharePort === null) return null;
  if (REMOTE?.role === "chat") return <GuestChat />;
  return <App />;
}

// Every icon draws with a slightly lighter line than lucide's default (explicit weights stay).
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <LucideProvider strokeWidth={1.75}>
      <Root />
    </LucideProvider>
  </StrictMode>,
);
