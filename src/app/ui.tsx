import { Blobatar } from "@blobatar/react";
import { happy, idle, sad, thinking } from "blobatar/expression";
import { CircleAlert } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import type { RunStatus } from "../contracts/run";

/** An agent's face. Its expression is its state: thinking while it works, happy or sad after. */
export function AgentFace({ seed, size = 32, status }: { seed: string; size?: number; status?: RunStatus | null }) {
  const expression = status === "running" || status === "queued" ? thinking : status === "succeeded" ? happy : status === "failed" ? sad : idle;
  // Tone locked to the vivid middle of the set: the auto tone can land near-black, which disappears on a dark UI.
  return <Blobatar name={`agent:${seed}`} size={size} tone={0.48} animate="always" expression={expression} title={seed} />;
}

function hueOf(hex: string): number {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) return 260;
  const [r, g, b] = m.slice(1).map((x) => parseInt(x, 16) / 255) as [number, number, number];
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  if (!d) return 0;
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return Math.round(h * 60 + 360) % 360;
}

/** A person on the board, tinted with their presence colour. */
export function PersonFace({ name, color, size = 26 }: { name: string; color: string; size?: number }) {
  return <Blobatar name={`person:${name}`} size={size} hue={hueOf(color)} tone={0.48} title={name} className="face" />;
}

export function Field(props: {
  label?: string;
  value: string;
  onChange: (v: string) => void;
  note?: ReactNode;
  error?: string | null;
  mono?: boolean;
  multiline?: boolean;
  rows?: number;
  placeholder?: string;
  type?: string;
  testId?: string;
  ariaLabel?: string;
}) {
  const { label, value, onChange, note, error, mono, multiline, rows, placeholder, type, testId, ariaLabel } = props;
  const cls = mono ? "mono" : undefined;
  const common = { className: cls, value, placeholder, spellCheck: !mono, "data-testid": testId, "aria-label": ariaLabel ?? label };
  return (
    <label className={`field${error ? " invalid" : ""}`}>
      {label && <span>{label}</span>}
      {multiline ? (
        <textarea {...common} rows={rows ?? 3} onChange={(e) => onChange(e.target.value)} />
      ) : (
        <input {...common} type={type ?? "text"} onChange={(e) => onChange(e.target.value)} />
      )}
      {error ? <span className="error">{error}</span> : note ? <span className="note">{note}</span> : null}
    </label>
  );
}

/** Structured text (args, env) kept raw while typing so half-typed lines survive. */
export function TextListField(props: { label: string; value: string; onCommit: (text: string) => void; placeholder?: string; rows?: number }) {
  const [text, setText] = useState(props.value);
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (!focused) setText(props.value);
  }, [props.value, focused]);
  return (
    <label className="field">
      <span>{props.label}</span>
      <textarea
        className="mono" rows={props.rows ?? 3} value={text} placeholder={props.placeholder} spellCheck={false} aria-label={props.label}
        onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
        onChange={(e) => { setText(e.target.value); props.onCommit(e.target.value); }}
      />
    </label>
  );
}

export function Segmented<T extends string>({ value, options, onChange }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="segmented" role="group">
      {options.map((o) => (
        <button key={o.value} type="button" aria-pressed={o.value === value} onClick={() => onChange(o.value)}>{o.label}</button>
      ))}
    </div>
  );
}

export const Kbd = ({ children }: { children: ReactNode }) => <span className="kbd">{children}</span>;

export function Empty({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty page-enter">
      <h3>{title}</h3>
      {children && <p>{children}</p>}
      {action}
    </div>
  );
}

export function Issues({ issues }: { issues: { level: "error" | "warning"; message: string }[] }) {
  if (!issues.length) return null;
  return (
    <div className="stack" style={{ gap: 6 }}>
      {issues.map((i, n) => (
        <div key={n} className={`issue${i.level === "warning" ? " warning" : ""}`}>
          <CircleAlert size={14} style={{ flex: "none", marginTop: 1 }} />
          <span>{i.message}</span>
        </div>
      ))}
    </div>
  );
}

/** Ticks once a second while mounted — for live elapsed clocks. */
export function useNow(active: boolean): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [active]);
  return now;
}

export function clock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
