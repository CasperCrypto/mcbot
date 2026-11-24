/**
 * Email an invite link. McBot has no mail server (no cloud, by design), so it opens a ready-to-send
 * message, recipients, subject and link filled in, in the person's own email: Gmail or Outlook on
 * the web (https, so it always opens), or the computer's mail app (mailto:, which needs one set up).
 */
export type MailService = "gmail" | "outlook" | "app";

export const MAIL_SERVICES: { value: MailService; label: string }[] = [
  { value: "gmail", label: "Gmail" },
  { value: "outlook", label: "Outlook" },
  { value: "app", label: "Mail app" },
];

const EMAIL = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/;
export const isEmail = (s: string) => EMAIL.test(s.trim());

/** "a@x.com, b@y.org" → ["a@x.com", "b@y.org"]; null when any address looks wrong. */
export function parseEmails(text: string): string[] | null {
  const list = text.split(/[\s,;]+/).map((s) => s.trim()).filter(Boolean);
  if (list.length === 0) return null;
  return list.every(isEmail) ? list : null;
}

export interface InviteWhat {
  /** Teammates edit and run the boards; guests chat with some agents. */
  role?: "edit" | "chat";
  /** A guest's agents, by name. */
  agents?: string[];
  /** The link opens McBot in a web browser (else: in McBot, Share → Join). */
  web?: boolean;
  /** Only on the sharer's network. */
  network?: boolean;
}

const listOf = (names: string[]) => (names.length <= 1 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`);

export function inviteMessage(from: string, link: string, what: InviteWhat = {}): { subject: string; body: string } {
  const chat = what.role === "chat";
  const agents = listOf(what.agents ?? []);
  const subject = chat ? `${from} invited you to chat with ${agents || "their AI agents"}` : `${from} invited you to McBot Studio`;
  const intro = chat ? `${from} invited you to chat with ${agents || "their AI agents"}.` : `${from} invited you to work on their AI agents in McBot Studio.`;
  const how = what.web === false
    ? `1. Open McBot Studio (get it at https://mcbot.studio)\n2. Click Share, then "Join someone else's"\n3. Paste this link:\n\n${link}`
    : `Open this link to join. There's no account to make and nothing to install:\n\n${link}`;
  const when = `The link works for 24 hours, while ${from}'s McBot is open${what.network ? ", on the same network" : ""}.`;
  return { subject, body: `${intro}\n\n${how}\n\n${when}` };
}

export function composeUrl(service: MailService, to: string[], subject: string, body: string): string {
  const q = (o: Record<string, string>) => Object.entries(o).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("&");
  if (service === "gmail") return `https://mail.google.com/mail/?${q({ view: "cm", fs: "1", to: to.join(","), su: subject, body })}`;
  if (service === "outlook") return `https://outlook.live.com/mail/0/deeplink/compose?${q({ to: to.join(","), subject, body })}`;
  return `mailto:${to.map(encodeURIComponent).join(",")}?${q({ subject, body })}`;
}
