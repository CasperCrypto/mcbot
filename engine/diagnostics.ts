/**
 * "Report a problem": what McBot can say about itself, as plain text the person
 * copies into a GitHub issue. Nothing is sent anywhere. Saved keys, anything that
 * looks like a token, and the home folder are hidden first.
 */
import { open } from "node:fs/promises";
import { arch, homedir, platform, release } from "node:os";
import type { HermesInfo } from "../src/contracts/api";

export const HIDDEN = "[hidden]";

/** Tokens that may reach the log without being one of McBot's saved keys. */
const TOKEN_PATTERNS: [RegExp, string][] = [
  [/\bsk-[A-Za-z0-9_-]{16,}/g, HIDDEN], // OpenAI-style keys (OpenAI, OpenRouter, DeepSeek, …)
  [/\b\d{6,12}:[A-Za-z0-9_-]{30,}/g, HIDDEN], // Telegram bot tokens
  [/\b(Bearer|Bot)\s+[A-Za-z0-9._~+/=-]{16,}/gi, `$1 ${HIDDEN}`], // Authorization headers
  [/\b([A-Za-z0-9_]*(?:API_KEY|TOKEN|SECRET|PASSWORD)[A-Za-z0-9_]*)(["']?\s*[=:]\s*)["']?[^\s"',}]{6,}["']?/gi, `$1$2${HIDDEN}`], // NAME=value, "name": "value"
];

/** Hide saved key values, token-shaped strings and the home folder. */
export function redact(text: string, secrets: string[], home: string = homedir()): string {
  let out = text;
  // Longest first, so a key that contains a shorter one is hidden whole.
  for (const value of [...new Set(secrets)].filter((v) => v.length >= 6).sort((a, b) => b.length - a.length)) {
    out = out.split(value).join(HIDDEN);
  }
  for (const [re, by] of TOKEN_PATTERNS) out = out.replace(re, by);
  if (home.length > 1) out = out.split(home).join("~");
  return out;
}

/** The end of a text file (at most `maxBytes`, whole lines), or null when there is no such file. */
export async function tail(file: string, maxBytes = 48_000, maxLines = 200): Promise<string | null> {
  let fh;
  try {
    fh = await open(file, "r");
  } catch {
    return null;
  }
  try {
    const { size } = await fh.stat();
    const start = Math.max(0, size - maxBytes);
    const buf = Buffer.alloc(size - start);
    await fh.read(buf, 0, buf.length, start);
    let text = buf.toString("utf8");
    if (start > 0) text = text.slice(text.indexOf("\n") + 1); // drop the partial first line
    const lines = text.replace(/\n+$/, "").split("\n");
    return lines.slice(-maxLines).join("\n");
  } finally {
    await fh.close();
  }
}

const OS_NAMES: Record<string, string> = { darwin: "macOS", win32: "Windows", linux: "Linux" };

export function osLine(p: string = platform(), r: string = release(), a: string = arch()): string {
  return `${OS_NAMES[p] ?? p} (${p} ${r}, ${a})`;
}

export interface DiagnosticsInput {
  version: string;
  os: string;
  installed: boolean;
  hermes: HermesInfo;
  boards: number;
  /** The engine log's last lines; null when there is no log file (development). */
  log: string | null;
  at: Date;
}

function engineLine(h: HermesInfo): string {
  if (h.kind === "bundled") return `built in, prepared${h.gateway.running ? `, gateway running` : ", gateway not running"}`;
  if (h.kind === "external") return `installed separately at ${h.path ?? "?"}${h.gateway.running ? ", gateway running" : ""}`;
  if (!h.source) return "not found";
  if (h.setup.state === "running") return `built in, preparing: ${h.setup.lines.at(-1) ?? "starting"}`;
  if (h.setup.state === "failed") return `built in, preparing failed: ${h.setup.lines.slice(-3).join(" / ") || "no output"}`;
  return "built in, not prepared yet";
}

/** The report as plain text, ready to redact and copy. */
export function diagnosticsText(d: DiagnosticsInput): string {
  const lines = [
    `McBot ${d.version} · ${d.installed ? "installed app" : "development"}`,
    `System: ${d.os}`,
    `Engine: ${engineLine(d.hermes)}`,
    ...(d.hermes.upstream ? [`Engine base: ${d.hermes.upstream.commit.slice(0, 12)} (${d.hermes.upstream.date})`] : []),
    `Boards: ${d.boards}`,
    `Time: ${d.at.toISOString()}`,
    "",
    d.log === null ? "No engine log: in development the engine logs to its terminal." : `Engine log, last lines:\n${d.log || "(empty)"}`,
  ];
  return `${lines.join("\n")}\n`;
}
