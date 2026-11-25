/**
 * What the agent asked (Hermes' clarify tool), as McBot shows and answers it. Pure.
 * Hermes marks its suggestion by suffixing the first choice with "(Recommended)"
 * (tools/clarify_tool.py `mark_recommended`) and strips it again from the answer, so the
 * choice is shown without it and sent back as Hermes gave it.
 */
export const RECOMMENDED = "(Recommended)";

export interface QuestionChoice {
  /** As shown. */
  label: string;
  /** As sent back (Hermes' own text). */
  value: string;
  recommended: boolean;
}

export function questionChoices(choices: readonly string[]): QuestionChoice[] {
  return choices.map((value) => {
    const t = value.trim();
    const recommended = t.toLowerCase().endsWith(RECOMMENDED.toLowerCase());
    return { label: recommended ? t.slice(0, -RECOMMENDED.length).trim() : t, value, recommended };
  });
}

/**
 * The answer Hermes reads (gateway/session_pending_controls.py `respond`, tools/clarify_tool.py
 * `_clean_answer`): a choice as given, several as a JSON array, typed text, or "" to skip.
 */
export function encodeAnswer(a: { picked: readonly string[]; multi: boolean } | { text: string } | "skip"): string {
  if (a === "skip") return "";
  if ("text" in a) return a.text.trim();
  return a.multi ? JSON.stringify(a.picked) : a.picked[0] ?? "";
}

/** Seconds left to answer, or null when Hermes gave no limit. */
export function secondsLeft(at: number, timeoutS: number | null, now: number): number | null {
  if (timeoutS === null || timeoutS <= 0) return null;
  return Math.max(0, Math.ceil((at + timeoutS * 1000 - now) / 1000));
}
