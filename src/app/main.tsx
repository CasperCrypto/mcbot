import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles/index.css";

// In the macOS app the title bar is an overlay: leave room for the traffic lights.
if ("__TAURI_INTERNALS__" in window && /Mac/.test(navigator.userAgent)) document.documentElement.dataset.shell = "mac";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
