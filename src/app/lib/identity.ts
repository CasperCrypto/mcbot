/** Who this window is on the shared board. No accounts in v0: a name and a color, kept per device. */
export const PEER_COLORS = ["#0a7aff", "#5e5ce6", "#bf5af2", "#ff375f", "#ff9f0a", "#1f9d55", "#00a3bf", "#8e8e93"] as const;

const NAMES = ["Ada", "Grace", "Alan", "Linus", "Hedy", "Ken", "Barbara", "Edsger", "Margaret", "Dennis", "Radia", "Tim"];

export interface Identity {
  name: string;
  color: string;
  /** The person typed this name (setup, Settings). A made-up one is never used to greet them. */
  chosen?: boolean;
}

const KEY = "mcbot.identity";

function random<T>(items: readonly T[]): T {
  return items[Math.floor(Math.random() * items.length)]!;
}

export function loadIdentity(): Identity {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? "null") as Identity | null;
    if (saved?.name && saved.color) return saved;
  } catch {
    /* private window or blocked storage: fall through to a fresh identity */
  }
  const fresh = { name: random(NAMES), color: random(PEER_COLORS) };
  saveIdentity(fresh);
  return fresh;
}

/** Whether the name is the person's own (older saved identities: any name McBot didn't make up). */
export const nameChosen = (id: Identity): boolean => id.chosen ?? !NAMES.includes(id.name);

export function saveIdentity(id: Identity): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(id));
  } catch {
    /* not persisted; the identity still applies to this window */
  }
}

