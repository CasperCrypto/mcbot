import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles/index.css";

// In the macOS app the title bar is an overlay: leave room for the traffic lights.
if ("__TAURI_INTERNALS__" in window && /Mac/.test(navigator.userAgent)) document.documentElement.dataset.shell = "mac";

// A tooltip steps aside once its control is clicked, until the pointer leaves it (as on macOS).
document.addEventListener("pointerdown", (e) => {
  const el = (e.target as Element | null)?.closest?.("[data-tip]");
  if (!el || el.hasAttribute("data-tip-off")) return;
  el.setAttribute("data-tip-off", "");
  el.addEventListener("pointerleave", () => el.removeAttribute("data-tip-off"), { once: true });
}, true);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
