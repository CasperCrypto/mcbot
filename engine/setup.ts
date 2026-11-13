/**
 * First-launch setup: what is on this computer (local model servers), the
 * models an OpenAI-compatible endpoint offers, and whether setup has run.
 */
import { atomicWrite, readTextOrNull } from "./fsutil";
import type { LocalServer, SetupProfile, SetupState } from "../src/contracts/api";

/** Default addresses of the OpenAI-compatible servers people run locally. */
export const LOCAL_SERVERS: readonly { name: string; baseUrl: string }[] = [
  { name: "Ollama", baseUrl: "http://127.0.0.1:11434/v1" },
  { name: "LM Studio", baseUrl: "http://127.0.0.1:1234/v1" },
  { name: "llama.cpp", baseUrl: "http://127.0.0.1:8080/v1" },
  { name: "vLLM", baseUrl: "http://127.0.0.1:8000/v1" },
  { name: "Jan", baseUrl: "http://127.0.0.1:1337/v1" },
];

/** `GET <baseUrl>/models` (the OpenAI list shape). null when the server does not answer. */
export async function listModels(baseUrl: string, apiKey?: string, timeoutMs = 1500): Promise<string[] | null> {
  let url: URL;
  try {
    url = new URL(`${baseUrl.replace(/\/+$/, "")}/models`);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  try {
    const res = await fetch(url, { headers: apiKey ? { authorization: `Bearer ${apiKey}` } : {}, signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return null;
    const body = (await res.json()) as { data?: { id?: unknown }[] };
    if (!Array.isArray(body.data)) return null;
    return [...new Set(body.data.map((m) => m.id).filter((id): id is string => typeof id === "string" && id.length > 0))].sort();
  } catch {
    return null;
  }
}

export async function detectLocal(servers: readonly { name: string; baseUrl: string }[] = LOCAL_SERVERS): Promise<LocalServer[]> {
  const found = await Promise.all(servers.map(async (s) => {
    const models = await listModels(s.baseUrl, undefined, 1200);
    return models ? { ...s, models } : null;
  }));
  return found.filter((s): s is LocalServer => s !== null);
}

/** <workspace>/setup.json: whether the setup assistant finished, and what it was told. */
export class SetupStore {
  constructor(private readonly file: string) {}

  async get(): Promise<SetupState> {
    try {
      const raw = JSON.parse((await readTextOrNull(this.file)) ?? "null") as { completedAt?: number; profile?: SetupProfile | null } | null;
      return { completed: typeof raw?.completedAt === "number", profile: raw?.profile ?? null };
    } catch {
      return { completed: false, profile: null };
    }
  }

  async complete(profile: SetupProfile | null): Promise<SetupState> {
    await atomicWrite(this.file, `${JSON.stringify({ completedAt: Date.now(), profile }, null, 2)}\n`);
    return { completed: true, profile };
  }
}
