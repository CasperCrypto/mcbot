/**
 * Hermes' goal loop says why it stopped a task in its own words (hermes_cli/goals.py
 * `run_kanban_goal_loop`, recorded as the run's summary): shown to people, plainly. Any other text is
 * the agent's or a person's and stays as it is.
 */
export function taskNote(text: string): string {
  const t = text.trim();
  let m = /^Goal-mode worker exhausted its turn budget \((\d+)\/\d+\) without completing the task\.\s*(?:Last judge verdict:\s*([\s\S]*))?$/.exec(t);
  if (m) return `Not done after ${m[1]} rounds${m[2]?.trim() ? `. Still missing: ${m[2].trim()}` : ""}`;
  m = /^Goal-mode judge ruled the goal unachievable:\s*([\s\S]*)$/.exec(t);
  if (m) return `Can't be done as asked: ${m[1]!.trim()}`;
  if (/^Goal-mode worker's output looked complete but it never called kanban_complete/.test(t)) return "Looks done. Check it, then mark it done.";
  return text;
}
