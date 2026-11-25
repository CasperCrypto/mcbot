/**
 * McBot Studio's own places (the code, the site, the X account) and the one time McBot asks for a
 * star: after a few good answers, once per computer, never in a window that joined someone else's
 * McBot or in the demo.
 */
export const REPO_URL = "https://github.com/CasperCrypto/mcbot";
export const SITE_URL = "https://mcbot.studio";
export const X_URL = "https://x.com/McBotstudio";

/** Good answers before McBot asks. */
export const STAR_AFTER = 5;
const ASKED = "mcbot.star.asked";

export function starAsked(): boolean {
  try {
    return localStorage.getItem(ASKED) === "1";
  } catch {
    return true; // no storage: never ask, rather than ask every launch
  }
}

export function markStarAsked(): void {
  try {
    localStorage.setItem(ASKED, "1");
  } catch {
    /* this session only */
  }
}

/** Whether to ask now: enough good answers, not asked before, and a window that is McBot's own. */
export const shouldAskForStar = (succeeded: number, ownWindow: boolean): boolean => ownWindow && succeeded >= STAR_AFTER && !starAsked();
