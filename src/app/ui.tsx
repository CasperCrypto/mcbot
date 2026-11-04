import { CircleAlert, X } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { useApp } from "./state/store";

export function Field(props: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  help?: ReactNode;
  error?: string | null;
  mono?: boolean;
  multiline?: boolean;
  rows?: number;
  placeholder?: string;
  type?: string;
  testId?: string;
}) {
  const { label, value, onChange, help, error, mono, multiline, rows, placeholder, type, testId } = props;
  const cls = mono ? "mono" : undefined;
  return (
    <label className={`field${error ? " invalid" : ""}`}>
      <span>{label}</span>
      {multiline ? (
        <textarea className={cls} rows={rows ?? 3} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} spellCheck={!mono} data-testid={testId} />
      ) : (
        <input className={cls} type={type ?? "text"} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} spellCheck={false} data-testid={testId} />
      )}
      {error ? <span className="error">{error}</span> : help ? <span className="help">{help}</span> : null}
    </label>
  );
}

/**
 * A text field whose committed value is structured (args, env). Keeps the raw
 * text locally while typing so half-typed lines are not reformatted away.
 */
export function TextListField(props: { label: string; value: string; onCommit: (text: string) => void; help?: ReactNode; placeholder?: string; rows?: number }) {
  const [text, setText] = useState(props.value);
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (!focused) setText(props.value);
  }, [props.value, focused]);
  return (
    <label className="field">
      <span>{props.label}</span>
      <textarea
        className="mono"
        rows={props.rows ?? 3}
        value={text}
        placeholder={props.placeholder}
        spellCheck={false}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onChange={(e) => {
          setText(e.target.value);
          props.onCommit(e.target.value);
        }}
      />
      {props.help && <span className="help">{props.help}</span>}
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

export function Empty({ icon, title, children, action }: { icon?: ReactNode; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      {icon && <div className="faint">{icon}</div>}
      <h3>{title}</h3>
      {children && <p>{children}</p>}
      {action}
    </div>
  );
}

export function Issues({ issues }: { issues: { level: "error" | "warning"; message: string }[] }) {
  if (!issues.length) return null;
  return (
    <div className="inspector-section" style={{ gap: 6 }}>
      {issues.map((i, n) => (
        <div key={n} className={`issue${i.level === "warning" ? " warning" : ""}`}>
          <CircleAlert size={14} style={{ flex: "none", marginTop: 1 }} />
          <span>{i.message}</span>
        </div>
      ))}
    </div>
  );
}

export function Toasts() {
  const toasts = useApp((s) => s.toasts);
  const dismiss = useApp((s) => s.dismiss);
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.kind}`}>
          <span style={{ flex: 1 }}>{t.text}</span>
          {t.action && (
            <button className="btn sm" onClick={() => { t.action!.run(); dismiss(t.id); }}>{t.action.label}</button>
          )}
          <button className="icon-btn" aria-label="Dismiss" onClick={() => dismiss(t.id)}><X size={14} /></button>
        </div>
      ))}
    </div>
  );
}
