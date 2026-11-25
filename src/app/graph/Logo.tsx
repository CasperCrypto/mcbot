/**
 * A brand's logo as a block tile: Simple Icons marks in the brand's colour, or an SVG dropped into
 * design/logos (drawn as an image, never as HTML). Unknown brands keep the kind's own tile.
 * Brand colours are content (the brand's identity), like note paper, not UI chrome.
 */
import { Cpu } from "lucide-react";
import type { CSSProperties, ReactNode } from "react";
import type { GraphNode, ModelData } from "../../contracts/graph";
import { LOGOS, type Logo } from "../lib/logos.generated";
import { MODEL_MARKS } from "../lib/modelMarks.generated";
import { modelFamily, modelName } from "../lib/modelName";

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
  // The brand's own colour as the tile, its glyph in the ink that reads on it (as the website draws them);
  // a near-black brand sits on the dark tile in white.
  return (
    <span className={`${cls} logo ${logo.tile ? "brand" : "neutral"}`} style={logo.tile ? ({ "--c": logo.tile, color: logo.ink } as CSSProperties) : undefined} data-tip={logo.title} data-tip-side="top">
      <svg viewBox="0 0 24 24" aria-hidden fill="currentColor"><path d={logo.path} /></svg>
    </span>
  );
}

/** A brand's mark as a glyph in the text colour, for a button: GitHub, X. Nothing when it has none. */
export function BrandGlyph({ brand, size = 13 }: { brand: string; size?: number }) {
  const l = LOGOS[brand];
  if (!l || "src" in l) return null;
  return <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden fill="currentColor"><path d={l.path} /></svg>;
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

/** The mark of the family a model belongs to (Claude, GPT, Llama…), else of the server it runs on. */
export function ModelMark({ model, baseUrl, size = 16 }: { model: string; baseUrl?: string; size?: number }) {
  const key = modelFamily(model, baseUrl);
  const mark = key ? MODEL_MARKS[key] : undefined;
  if (!mark) return <span className="model-mark none" style={{ width: size, height: size }} aria-hidden><Cpu size={Math.round(size * 0.72)} /></span>;
  return <img className="model-mark" src={mark.src} width={size} height={size} alt="" draggable={false} />;
}

/** A model as a chip: its family's mark and the name people say; the full id in the tooltip. */
export function ModelChip({ model, baseUrl, more = 0 }: { model: string | undefined; baseUrl?: string; more?: number }) {
  if (!model) return <span className="model-chip empty">No model</span>;
  return (
    <span className="model-chip" data-tip={more ? `${model} · ${more} backup${more > 1 ? "s" : ""}` : model}>
      <ModelMark model={model} baseUrl={baseUrl} size={14} />
      <span className="ellipsis">{modelName(model)}</span>
      {more > 0 && <span className="model-more">+{more}</span>}
    </span>
  );
}

/** A model block's title: the person's own label, else the model's name ("Cloud model" says nothing). */
export function modelTitle(m: ModelData): string {
  const own = m.label.trim();
  return own && !/^(cloud|local) model$/i.test(own) ? own : modelName(m.model) || own || m.name;
}

/** Where a model runs, in words: "On this computer · Ollama", "OpenRouter". */
export function modelWhere(m: ModelData): string {
  const server = logoFor([], m.baseUrl);
  const name = server && "title" in server ? server.title : null;
  return m.endpoint === "local" ? `On this computer${name ? ` · ${name}` : ""}` : name ?? "Cloud";
}
