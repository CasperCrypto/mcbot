/** Report a problem: where issues go, and what the new issue starts with. */
export const ISSUES_URL = "https://github.com/CasperCrypto/mcbot/issues/new";

/**
 * A new issue with the report's summary filled in (version, system, engine state).
 * The engine log is not put in the link: it stays on this computer until pasted.
 */
export function issueUrl(details: string): string {
  const summary = (details.split("\n\n")[0] ?? "").trim();
  const body = [
    "**What happened?**", "", "", "**What did you expect?**", "", "",
    "**McBot**", "```", summary, "```", "",
    "<!-- If it helps, paste the engine log from McBot: ⌘K → Report a problem → Copy. -->",
  ].join("\n");
  return `${ISSUES_URL}?${new URLSearchParams({ body }).toString()}`;
}
