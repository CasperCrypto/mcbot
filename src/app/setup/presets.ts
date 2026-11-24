/**
 * Small helpers the setup assistant shares with the board it builds (setup/onboarding.ts): the
 * model choices, the facts every agent's USER.md starts with, and the board's name.
 * Pure, tested.
 */
import type { SetupProfile } from "../../contracts/api";

export interface ModelChoice {
  endpoint: "local" | "cloud";
  label: string;
  baseUrl: string;
  model: string;
  /** Env var name of the API key (cloud). */
  apiKeyEnv: string;
}

/** Trimmed, ending in a full stop. */
const sentence = (s: string) => {
  const t = s.trim();
  return !t || /[.!?]$/.test(t) ? t : `${t}.`;
};

/** What every agent should know about the person from day one (Hermes USER.md, 1375 chars max). */
export function userFacts(p: SetupProfile): string {
  const parts: string[] = [];
  if (p.kind === "personal") {
    if (p.name) parts.push(`The user is ${p.name}.`);
    if (p.about) parts.push(`Wants help with: ${sentence(p.about)}`);
  } else {
    if (p.name) parts.push(`The user is ${p.name}${p.role ? `, ${p.role}` : ""}${p.company ? ` at ${p.company}` : ""}.`);
    if (p.company && p.about) parts.push(`${p.company}: ${sentence(p.about)}`);
  }
  return parts.join(" ").slice(0, 1300);
}

export function boardName(p: SetupProfile): string {
  if (p.kind !== "personal" && p.company.trim()) return p.company.trim();
  return p.name.trim() ? `${p.name.trim()}'s agents` : "My agents";
}
