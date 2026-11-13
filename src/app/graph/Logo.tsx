/**
 * A brand's logo as a block tile: Simple Icons marks in the brand's colour, or an SVG dropped into
 * design/logos (drawn as an image, never as HTML). Unknown brands keep the kind's own tile.
 * Brand colours are content (the brand's identity), like note paper, not UI chrome.
 */
import type { ReactNode } from "react";
import type { GraphNode } from "../../contracts/graph";
import { LOGOS, type Logo } from "../lib/logos.generated";

/** Local model servers by their usual port (the setup assistant's list). */
const PORTS: Record<string, string> = { "11434": "ollama", "1234": "lmstudio", "8000": "vllm", "1337": "jan" };
const HOSTS: Record<string, string> = { googleapis: "gemini" };

/** The first known logo among these keys, then the URL's site name (mcp.linear.app → linear). */
export function logoFor(keys: (string | null | undefined)[], url?: string): Logo | null {
  for (const k of keys) if (k && LOGOS[k]) return LOGOS[k]!;
  if (url) {
    try {
      const u = new URL(url);
      const local = PORTS[u.port];
      if (local && LOGOS[local]) return LOGOS[local]!;
      for (const p of u.hostname.split(".").slice(0, -1).reverse()) {
        const k = HOSTS[p] ?? p;
        if (LOGOS[k]) return LOGOS[k]!;
      }
    } catch {
      /* not a URL */
    }
  }
  return null;
}

export function LogoTile({ logo, kind, sm, children }: { logo: Logo | null; kind: string; sm?: boolean; children: ReactNode }) {
  const cls = `tile${sm ? " sm" : ""}`;
  if (!logo) return <span className={`${cls} ${kind}`}>{children}</span>;
  if ("src" in logo) return <span className={`${cls} logo dropped`}><img src={logo.src} alt="" draggable={false} /></span>;
  return (
    <span className={`${cls} logo`} style={logo.tile ? { background: logo.tile } : undefined} data-tip={logo.title} data-tip-side="top">
      <svg viewBox="0 0 24 24" width={sm ? 14 : 17} height={sm ? 14 : 17} aria-hidden fill={logo.ink}><path d={logo.path} /></svg>
    </span>
  );
}

/** A block's brand: a tool or connector by its name or address, a chat app by platform, a model by its server, a maker by its service. */
export function nodeLogo(n: GraphNode): Logo | null {
  switch (n.kind) {
    case "tool": return logoFor([n.data.name, n.data.name.replace(/-\d+$/, "")], n.data.transport === "http" ? n.data.url : undefined);
    case "channel": return logoFor([n.data.platform]);
    case "model": return logoFor([], n.data.baseUrl);
    case "media": return logoFor([n.data.provider]);
    default: return null;
  }
}
