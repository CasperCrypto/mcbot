import { Check, Copy } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { openExternal } from "../lib/open";
import { parseRich, type Chart, type Inline } from "./rich";

/** Series colours: the agent palette, in a fixed order (tokens.css --food-*). */
const COLORS = ["var(--food-2)", "var(--food-6)", "var(--food-4)", "var(--food-9)", "var(--food-1)", "var(--food-7)"];

function Inlines({ v, image }: { v: Inline[]; image?: (src: string, alt: string) => ReactNode }) {
  return (
    <>
      {v.map((x, i) => {
        if (x.t === "text") return <span key={i}>{x.v}</span>;
        if (x.t === "b") return <strong key={i}><Inlines v={x.v} image={image} /></strong>;
        if (x.t === "i") return <em key={i}><Inlines v={x.v} image={image} /></em>;
        if (x.t === "code") return <code key={i} className="rich-code-inline">{x.v}</code>;
        if (x.t === "img") return <span key={i} className="rich-img">{image ? image(x.src, x.alt) : x.alt}</span>;
        const safe = /^https?:\/\//i.test(x.href);
        return safe
          ? <a key={i} href={x.href} onClick={(e) => { e.preventDefault(); void openExternal(x.href); }}>{x.v}</a>
          : <span key={i} className="rich-link-off" data-tip={x.href}>{x.v}</span>;
      })}
    </>
  );
}

function CodeBlock({ lang, v }: { lang: string; v: string }) {
  const [done, setDone] = useState(false);
  return (
    <div className="rich-code">
      <div className="rich-code-head">
        <span>{lang || "text"}</span>
        <button className="icon-btn sm" aria-label="Copy" data-tip={done ? "Copied" : "Copy"} onClick={() => void navigator.clipboard?.writeText(v).then(() => { setDone(true); setTimeout(() => setDone(false), 1400); })}>
          {done ? <Check size={12} /> : <Copy size={12} />}
        </button>
      </div>
      <pre>{v}</pre>
    </div>
  );
}

const fmt = (n: number) => (Math.abs(n) >= 1e6 ? `${+(n / 1e6).toFixed(1)}M` : Math.abs(n) >= 1e3 ? `${+(n / 1e3).toFixed(1)}k` : `${+n.toFixed(2)}`);

/** A chart an agent asked for: bars, lines or a pie, in SVG, sized to the chat column. */
export function ChartView({ chart }: { chart: Chart }) {
  const W = 560;
  const H = 240;
  const pad = { l: 44, r: 12, t: 12, b: 28 };
  const legend = chart.series.length > 1 || chart.type === "pie";
  let body: ReactNode;
  if (chart.type === "pie") {
    const data = chart.series[0]!.data.map((d) => Math.max(0, d));
    const total = data.reduce((a, b) => a + b, 0) || 1;
    let angle = -Math.PI / 2;
    const r = 92;
    const cx = 130;
    const cy = H / 2;
    body = data.map((d, i) => {
      const a0 = angle;
      const a1 = (angle += (d / total) * Math.PI * 2);
      const large = a1 - a0 > Math.PI ? 1 : 0;
      const path = d >= total ? `M ${cx} ${cy - r} A ${r} ${r} 0 1 1 ${cx - 0.01} ${cy - r} Z`
        : `M ${cx} ${cy} L ${cx + r * Math.cos(a0)} ${cy + r * Math.sin(a0)} A ${r} ${r} 0 ${large} 1 ${cx + r * Math.cos(a1)} ${cy + r * Math.sin(a1)} Z`;
      return <path key={i} d={path} style={{ fill: COLORS[i % COLORS.length] }} className="rich-chart-mark"><title>{`${chart.labels[i] ?? ""}: ${fmt(d)} (${Math.round((d / total) * 100)}%)`}</title></path>;
    });
  } else {
    const all = chart.series.flatMap((s) => s.data);
    const max = Math.max(0, ...all);
    const min = Math.min(0, ...all);
    const span = max - min || 1;
    const iw = W - pad.l - pad.r;
    const ih = H - pad.t - pad.b;
    const y = (v: number) => pad.t + ih - ((v - min) / span) * ih;
    const n = chart.labels.length || 1;
    const step = iw / n;
    const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => min + f * span);
    const grid = ticks.map((t, i) => (
      <g key={`g${i}`}>
        <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} className="rich-chart-grid" />
        <text x={pad.l - 6} y={y(t) + 3} textAnchor="end" className="rich-chart-tick">{fmt(t)}</text>
      </g>
    ));
    const every = Math.ceil(n / 10);
    const xLabels = chart.labels.map((l, i) => i % every === 0
      ? <text key={`x${i}`} x={pad.l + step * i + step / 2} y={H - 8} textAnchor="middle" className="rich-chart-tick">{l.length > 10 ? `${l.slice(0, 9)}…` : l}</text> : null);
    const marks = chart.type === "bar"
      ? chart.series.flatMap((s, si) => s.data.map((d, i) => {
        const bw = (step * 0.72) / chart.series.length;
        const x = pad.l + step * i + step * 0.14 + bw * si;
        return <rect key={`${si}-${i}`} x={x} y={Math.min(y(d), y(0))} width={Math.max(1, bw - 2)} height={Math.abs(y(d) - y(0))} rx={3} style={{ fill: COLORS[si % COLORS.length] }} className="rich-chart-mark"><title>{`${s.name} · ${chart.labels[i] ?? ""}: ${fmt(d)}`}</title></rect>;
      }))
      : chart.series.map((s, si) => (
        <g key={si}>
          <polyline fill="none" strokeWidth={2.2} strokeLinejoin="round" strokeLinecap="round" style={{ stroke: COLORS[si % COLORS.length] }}
            points={s.data.map((d, i) => `${pad.l + step * i + step / 2},${y(d)}`).join(" ")} />
          {s.data.map((d, i) => <circle key={i} cx={pad.l + step * i + step / 2} cy={y(d)} r={3} style={{ fill: COLORS[si % COLORS.length] }} className="rich-chart-mark"><title>{`${s.name} · ${chart.labels[i] ?? ""}: ${fmt(d)}`}</title></circle>)}
        </g>
      ));
    body = <>{grid}{marks}{xLabels}</>;
  }
  return (
    <figure className="rich-chart" data-testid="rich-chart">
      {chart.title && <figcaption>{chart.title}</figcaption>}
      <div className="rich-chart-body">
        <svg viewBox={`0 0 ${chart.type === "pie" ? 260 : W} ${H}`} role="img" aria-label={chart.title ?? "Chart"}>{body}</svg>
        {legend && (
          <ul className="rich-chart-legend">
            {(chart.type === "pie" ? chart.labels : chart.series.map((s) => s.name)).map((name, i) => (
              <li key={i}><i style={{ background: COLORS[i % COLORS.length] }} />{name}{chart.type === "pie" ? <b>{fmt(chart.series[0]!.data[i] ?? 0)}</b> : null}</li>
            ))}
          </ul>
        )}
      </div>
    </figure>
  );
}

/**
 * An answer, drawn: Markdown, charts, code with Copy, and reply buttons (`onChoose`, offered only
 * on the latest answer). `image` draws an image the answer points at (a file the agent made).
 */
export function RichText({ text, onChoose, image }: { text: string; onChoose?: (reply: string) => void; image?: (src: string, alt: string) => ReactNode }) {
  const blocks = useMemo(() => parseRich(text), [text]);
  return (
    <div className="rich" data-testid="agent-text">
      {blocks.map((b, i) => {
        switch (b.t) {
          case "p": return <p key={i}><Inlines v={b.v} image={image} /></p>;
          case "h": return b.level === 1 ? <h3 key={i}><Inlines v={b.v} /></h3> : b.level === 2 ? <h4 key={i}><Inlines v={b.v} /></h4> : <h5 key={i}><Inlines v={b.v} /></h5>;
          case "ul": return <ul key={i}>{b.items.map((it, j) => <li key={j}><Inlines v={it} image={image} /></li>)}</ul>;
          case "ol": return <ol key={i}>{b.items.map((it, j) => <li key={j}><Inlines v={it} image={image} /></li>)}</ol>;
          case "quote": return <blockquote key={i}><Inlines v={b.v} /></blockquote>;
          case "hr": return <hr key={i} />;
          case "code": return <CodeBlock key={i} lang={b.lang} v={b.v} />;
          case "chart": return <ChartView key={i} chart={b.chart} />;
          case "table": return (
            <div key={i} className="rich-table"><table>
              <thead><tr>{b.head.map((c, j) => <th key={j}><Inlines v={c} /></th>)}</tr></thead>
              <tbody>{b.rows.map((r, j) => <tr key={j}>{r.map((c, k) => <td key={k}><Inlines v={c} image={image} /></td>)}</tr>)}</tbody>
            </table></div>
          );
          case "choices": return onChoose ? (
            <div key={i} className="rich-choices" data-testid="rich-choices">
              {b.items.map((c) => <button key={c} className="rich-choice" onClick={() => onChoose(c)}>{c}</button>)}
            </div>
          ) : null;
        }
      })}
    </div>
  );
}
