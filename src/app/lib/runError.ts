/**
 * A failed run's reason as people read it. Hermes and the network answer in codes
 * (`runtime_draining`, `fetch failed`); the run keeps the code (Runs shows it), Home and
 * notifications show the sentence.
 */
const SAID: [RegExp, string][] = [
  [/runtime_draining|gateway_draining|draining existing work|Gateway (is )?(starting|draining)/i, "The engine was restarting"],
  [/fetch failed|ECONNREFUSED|ECONNRESET|socket hang up/i, "Couldn't reach the engine"],
  [/\b401\b|unauthori[sz]ed|invalid api key|incorrect api key/i, "The model's key was refused"],
  [/\b429\b|rate.?limit|quota/i, "The model is rate limited"],
  [/context (length|window)|maximum context|too many tokens/i, "Too long for the model"],
  [/model .*not found|unknown model|no such model/i, "The model wasn't found"],
];

export function runError(error: string | null | undefined): string {
  if (!error?.trim()) return "See the run";
  for (const [re, said] of SAID) if (re.test(error)) return said;
  return error.trim();
}
