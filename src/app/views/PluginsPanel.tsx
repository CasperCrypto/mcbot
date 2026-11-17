/**
 * Plugins, per agent: Hermes' own plugin system. Installed plugins with an on/off switch, and the
 * curated catalog (hermes/plugin-catalog, 2000+ entries) to add more. Installing clones the
 * pinned commit, runs Hermes' security scan and turns it on (`hermes -p <agent> plugins install
 * <name> --enable`); Hermes writes `plugins.enabled` itself, so a compile never undoes it.
 */
import { Download, Search, ShieldCheck, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { CatalogPlugin, InstalledPlugin } from "../../contracts/api";
import { engine } from "../lib/engine";
import { useApp } from "../state/store";
import { SkeletonCards } from "../ui";

const PAGE = 60;
let catalogCache: CatalogPlugin[] | null = null;

export function PluginsPanel({ profile, label, compiled, onCompile }: { profile: string; label: string; compiled: boolean; onCompile: () => void }) {
  const toast = useApp((s) => s.toast);
  const [catalog, setCatalog] = useState<CatalogPlugin[] | null>(catalogCache);
  const [installed, setInstalled] = useState<InstalledPlugin[] | null>(null);
  const [q, setQ] = useState("");
  const [cat, setCat] = useState<string | null>(null);
  const [limit, setLimit] = useState(PAGE);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    if (catalogCache) return;
    engine.pluginCatalog().then((r) => { catalogCache = r.plugins; setCatalog(r.plugins); }).catch(() => setCatalog([]));
  }, []);
  useEffect(() => {
    let live = true;
    setInstalled(null);
    if (compiled) engine.plugins(profile).then((r) => { if (live) setInstalled(r.installed); }).catch(() => { if (live) setInstalled([]); });
    return () => { live = false; };
  }, [profile, compiled]);

  const act = async (name: string, a: "install" | "enable" | "disable" | "remove") => {
    setBusy(name);
    try {
      const r = await engine.pluginAct(profile, name, a);
      setInstalled(r.installed);
      toast({ kind: "ok", text: `${name} ${a === "install" ? `added to ${label}` : a === "remove" ? "removed" : a === "enable" ? "on" : "off"}` });
    } catch (e) {
      toast({ kind: "fail", text: (e as Error).message });
    } finally {
      setBusy(null);
    }
  };

  const mine = (installed ?? []).filter((p) => !p.source.startsWith("bundled") || p.enabled);
  const has = new Set((installed ?? []).map((p) => p.name));
  const cats = useMemo(() => [...new Set((catalog ?? []).map((p) => p.category))].sort(), [catalog]);
  const words = q.trim().toLowerCase();
  const shown = useMemo(() => (catalog ?? [])
    .filter((p) => (!cat || p.category === cat) && (!words || `${p.name} ${p.title} ${p.summary} ${p.category} ${p.maintainer}`.toLowerCase().includes(words)))
    // official and verified first, then by name
    .sort((a, b) => rank(a.tier) - rank(b.tier) || a.title.localeCompare(b.title)), [catalog, cat, words]);

  return (
    <>
      <div className="stack" style={{ gap: 8 }} data-testid="plugins-installed">
        <div className="row"><span className="section-label grow">In {label}{mine.length ? ` · ${mine.length}` : ""}</span></div>
        {!compiled ? (
          <div className="row skill-builtin"><span className="grow faint">Plugins go into the agent on disk.</span><button className="btn sm primary" onClick={onCompile}>Compile</button></div>
        ) : !installed ? <SkeletonCards count={2} /> : mine.length === 0 ? <span className="faint">None yet. Add one below.</span> : (
          <div className="catalog-grid">
            {mine.map((p) => (
              <div key={p.name} className="catalog-card skill-card-lib" data-testid={`plugin-${p.name}`}>
                <span className="grow" style={{ display: "grid", gap: 2, minWidth: 0 }}>
                  <b className="ellipsis">{p.name}</b>
                  <span className="faint">{p.summary}</span>
                </span>
                <span className="row" style={{ gap: 6 }}>
                  {!p.source.startsWith("bundled") && <button className="btn ghost sm" aria-label={`Remove ${p.name}`} data-tip="Remove" disabled={busy !== null} onClick={() => void act(p.name, "remove")}><Trash2 size={12} /></button>}
                  <button type="button" className="switch" role="switch" aria-checked={p.enabled} aria-label={p.name} disabled={busy !== null} onClick={() => void act(p.name, p.enabled ? "disable" : "enable")}><span /></button>
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="stack" style={{ gap: 10 }}>
        <div className="row"><span className="section-label grow">Catalog{catalog?.length ? ` · ${catalog.length}` : ""}</span><span className="chip" data-tip="Each install is checked by Hermes' security scan at a pinned version"><ShieldCheck size={11} /> Scanned</span></div>
        <label className="catalog-search"><Search size={14} /><input value={q} onChange={(e) => { setQ(e.target.value); setLimit(PAGE); }} placeholder="Search plugins" aria-label="Search plugins" data-testid="plugins-search" /></label>
        {cats.length > 0 && (
          <div className="abilities">
            <button type="button" className="ability" aria-pressed={!cat} onClick={() => setCat(null)}>All</button>
            {cats.map((c) => <button key={c} type="button" className="ability" aria-pressed={cat === c} onClick={() => { setCat(cat === c ? null : c); setLimit(PAGE); }}>{c[0]!.toUpperCase() + c.slice(1)}</button>)}
          </div>
        )}
        {!catalog ? <SkeletonCards count={6} /> : shown.length === 0 ? <span className="faint">Nothing matches.</span> : (
          <div className="catalog-grid">
            {shown.slice(0, limit).map((p) => (
              <div key={p.name} className="catalog-card skill-card-lib" data-testid={`cat-${p.name}`}>
                <span className="grow" style={{ display: "grid", gap: 2, minWidth: 0 }}>
                  <span className="row" style={{ gap: 6, minWidth: 0 }}>
                    <b className="ellipsis">{p.title}</b>
                    {p.tier !== "community" && <span className={`chip ${p.tier === "official" ? "ok" : ""}`}>{p.tier}</span>}
                  </span>
                  <span className="faint" data-tip={[p.maintainer && `by ${p.maintainer}`, p.tools && `${p.tools} tools`, p.hooks && `${p.hooks} hooks`, p.needsKeys.length && `needs ${p.needsKeys.join(", ")}`, p.platforms.length && p.platforms.join(", ")].filter(Boolean).join(" · ") || undefined}>{p.summary}</span>
                </span>
                {has.has(p.name) ? <span className="chip ok">Added</span>
                  : <button className="btn sm" disabled={busy !== null || !compiled} onClick={() => void act(p.name, "install")} data-tip={compiled ? undefined : "Compile first"}>
                    <Download size={12} /> {busy === p.name ? "Adding…" : "Add"}
                  </button>}
              </div>
            ))}
          </div>
        )}
        {shown.length > limit && <button className="btn ghost sm" onClick={() => setLimit(limit + PAGE)}>Show more ({shown.length - limit})</button>}
      </div>
    </>
  );
}

const rank = (tier: string) => (tier === "official" ? 0 : tier === "verified" ? 1 : 2);
