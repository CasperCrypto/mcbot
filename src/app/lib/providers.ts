/**
 * Where models come from, as presets: every one is an OpenAI-compatible endpoint (hard rule 4:
 * one local, one cloud kind, no vendor SDKs). A preset is only an address and the name McBot
 * saves its key under; the board's model block carries the same two things.
 */
export interface CloudProvider {
  id: string;
  label: string;
  baseUrl: string;
  /** The variable the key is saved under in McBot and written to an agent's .env. */
  keyEnv: string;
  /** Where to get a key. */
  keysUrl: string;
  /** A sensible first model; the person can pick another from the provider's list. */
  model: string;
}

export const CLOUD_PROVIDERS: CloudProvider[] = [
  { id: "openrouter", label: "OpenRouter", baseUrl: "https://openrouter.ai/api/v1", keyEnv: "OPENROUTER_API_KEY", keysUrl: "https://openrouter.ai/keys", model: "openai/gpt-4o-mini" },
  { id: "openai", label: "OpenAI", baseUrl: "https://api.openai.com/v1", keyEnv: "OPENAI_API_KEY", keysUrl: "https://platform.openai.com/api-keys", model: "gpt-4o-mini" },
  { id: "anthropic", label: "Anthropic", baseUrl: "https://api.anthropic.com/v1", keyEnv: "ANTHROPIC_API_KEY", keysUrl: "https://console.anthropic.com/settings/keys", model: "claude-sonnet-5-5" },
  { id: "gemini", label: "Google Gemini", baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai", keyEnv: "GEMINI_API_KEY", keysUrl: "https://aistudio.google.com/apikey", model: "gemini-2.5-flash" },
  { id: "groq", label: "Groq", baseUrl: "https://api.groq.com/openai/v1", keyEnv: "GROQ_API_KEY", keysUrl: "https://console.groq.com/keys", model: "llama-3.3-70b-versatile" },
  { id: "deepseek", label: "DeepSeek", baseUrl: "https://api.deepseek.com/v1", keyEnv: "DEEPSEEK_API_KEY", keysUrl: "https://platform.deepseek.com/api_keys", model: "deepseek-chat" },
  { id: "mistral", label: "Mistral", baseUrl: "https://api.mistral.ai/v1", keyEnv: "MISTRAL_API_KEY", keysUrl: "https://console.mistral.ai/api-keys", model: "mistral-small-latest" },
  // Base URL and key variable: hermes_cli/auth.py:223 (Hermes' own opencode-zen provider). The first model is a
  // guess to be replaced by the provider's list (`/v1/models`); whether Zen answers without a key is not verified.
  { id: "opencode-zen", label: "OpenCode Zen", baseUrl: "https://opencode.ai/zen/v1", keyEnv: "OPENCODE_ZEN_API_KEY", keysUrl: "https://opencode.ai/auth", model: "deepseek-flash" },
  // OpenCode's Go subscription (open models for a flat monthly price): hermes_cli/auth.py:227. Same host as Zen,
  // so presets are told apart by their whole address (providerOf). The model comes from the provider's list.
  { id: "opencode-go", label: "OpenCode Go", baseUrl: "https://opencode.ai/zen/go/v1", keyEnv: "OPENCODE_GO_API_KEY", keysUrl: "https://opencode.ai/auth", model: "" },
  // Concentrate: one OpenAI-compatible gateway to 100+ models with routing and fallbacks, no fees on top
  // (concentrate.ai). Not one of Hermes' named providers: it runs as McBot's own `mcbot-<name>` endpoint like any other.
  { id: "concentrate", label: "Concentrate", baseUrl: "https://api.concentrate.ai/v1", keyEnv: "CONCENTRATE_API_KEY", keysUrl: "https://concentrate.ai", model: "" },
  { id: "together", label: "Together", baseUrl: "https://api.together.xyz/v1", keyEnv: "TOGETHER_API_KEY", keysUrl: "https://api.together.ai/settings/api-keys", model: "meta-llama/Llama-3.3-70B-Instruct-Turbo" },
];

/** Servers people run on their own computer, at their default addresses (engine/setup.ts asks them). */
export const LOCAL_PRESETS = [
  { label: "Ollama", baseUrl: "http://127.0.0.1:11434/v1" },
  { label: "LM Studio", baseUrl: "http://127.0.0.1:1234/v1" },
  { label: "llama.cpp", baseUrl: "http://127.0.0.1:8080/v1" },
  { label: "vLLM", baseUrl: "http://127.0.0.1:8000/v1" },
  { label: "Jan", baseUrl: "http://127.0.0.1:1337/v1" },
];

/** The preset an address belongs to, if any: the longest preset address it starts with, else the first on its host. */
export const providerOf = (baseUrl: string): CloudProvider | undefined => {
  const norm = (u: string) => u.trim().replace(/\/+$/, "").toLowerCase();
  const b = norm(baseUrl);
  const byPath = CLOUD_PROVIDERS.filter((p) => b === norm(p.baseUrl) || b.startsWith(`${norm(p.baseUrl)}/`))
    .sort((x, y) => y.baseUrl.length - x.baseUrl.length)[0];
  if (byPath) return byPath;
  const host = (() => {
    try {
      return new URL(baseUrl).host;
    } catch {
      return "";
    }
  })();
  return host ? CLOUD_PROVIDERS.find((p) => new URL(p.baseUrl).host === host) : undefined;
};

/** The key name for a cloud address: the provider's usual one, else one of McBot's own per model. */
export const keyEnvFor = (baseUrl: string, modelName: string): string =>
  providerOf(baseUrl)?.keyEnv ?? `MCBOT_${modelName.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}_API_KEY`;

/** A model block's `name` (a slug, unique on the board) from a label or model id. */
export const modelSlug = (text: string): string =>
  text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "model";
