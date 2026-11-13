/**
 * Email an invite link. McBot has no mail server (no cloud, by design), so it opens a ready-to-send
 * message, recipient, subject and link filled in, in the person's own email: Gmail or Outlook on
 * the web (https, so it always opens), or the computer's mail app (mailto:, which needs one set up).
 */
export type MailService = "gmail" | "outlook" | "app";

export const MAIL_SERVICES: { value: MailService; label: string }[] = [
  { value: "gmail", label: "Gmail" },
  { value: "outlook", label: "Outlook" },
  { value: "app", label: "Mail app" },
];

/** "a@x.com, b@y.org" → ["a@x.com", "b@y.org"]; null when any address looks wrong. */
export function parseEmails(text: string): string[] | null {
  const list = text.split(/[\s,;]+/).map((s) => s.trim()).filter(Boolean);
  if (list.length === 0) return null;
  return list.every((e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) ? list : null;
}

export function inviteMessage(from: string, link: string): { subject: string; body: string } {
  return {
    subject: `${from} invited you to McBot`,
    body: `${from} invited you to their McBot boards.\n\n1. Open McBot (get it at https://caspercrypto.github.io/mcbot/)\n2. Click Share, then "Join someone else's"\n3. Paste this link:\n\n${link}\n\nIt works for 24 hours, on the same network.`,
  };
}

export function composeUrl(service: MailService, to: string[], subject: string, body: string): string {
  const q = (o: Record<string, string>) => Object.entries(o).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("&");
  if (service === "gmail") return `https://mail.google.com/mail/?${q({ view: "cm", fs: "1", to: to.join(","), su: subject, body })}`;
  if (service === "outlook") return `https://outlook.live.com/mail/0/deeplink/compose?${q({ to: to.join(","), subject, body })}`;
  return `mailto:${to.map(encodeURIComponent).join(",")}?${q({ subject, body })}`;
}
