/**
 * A model id as people read it, and which family's mark goes with it: "anthropic/claude-sonnet-4-5"
 * reads "Claude Sonnet 4.5" with Claude's mark, "qwen3:8b" reads "Qwen3 8B" with Qwen's. Pure, so the
 * board, chat, Settings and Cost show the same name, and long ids never break a layout. The full id
 * stays in tooltips and in the files compile writes.
 */

/** Which family a model id belongs to (the key of its mark in MODEL_MARKS), first match wins. */
const FAMILIES: [RegExp, string][] = [
  [/claude/, "claude"],
  [/(^|[/_-])(gpt|chatgpt|o[134](-|$)|davinci|openai)/, "openai"],
  [/gemma/, "gemma"],
  [/gemini|palm|bard/, "gemini"],
  [/grok|xai/, "grok"],
  [/llama|meta-/, "meta"],
  [/qwen|qwq/, "qwen"],
  [/deepseek/, "deepseek"],
  [/mistral|mixtral|codestral|devstral|magistral|ministral|pixtral/, "mistral"],
  [/kimi|moonshot/, "kimi"],
  [/glm|zhipu|chatglm/, "zhipu"],
  [/minimax|abab/, "minimax"],
  [/phi-?\d|microsoft/, "microsoft"],
  [/command|cohere|aya/, "cohere"],
  [/hermes|nous/, "nousresearch"],
  [/nemotron|nvidia/, "nvidia"],
  [/sonar|perplexity/, "perplexity"],
];

/** Where the model is served, when its id says nothing about its family. */
const SERVERS: [RegExp, string][] = [
  [/:11434\b|ollama/, "ollama"],
  [/:1234\b|lmstudio|lm-studio/, "lmstudio"],
  [/:8000\b|vllm/, "vllm"],
  [/openrouter/, "openrouter"],
  [/groq/, "groq"],
  [/together/, "together"],
  [/huggingface|hf\.co/, "huggingface"],
];

export function modelFamily(model: string, baseUrl = ""): string | null {
  const id = model.toLowerCase();
  for (const [re, key] of FAMILIES) if (re.test(id)) return key;
  const at = baseUrl.toLowerCase();
  for (const [re, key] of SERVERS) if (re.test(at)) return key;
  return null;
}

const WORDS: Record<string, string> = {
  claude: "Claude", sonnet: "Sonnet", opus: "Opus", haiku: "Haiku", gpt: "GPT", chatgpt: "ChatGPT", gemini: "Gemini",
  gemma: "Gemma", flash: "Flash", pro: "Pro", ultra: "Ultra", nano: "Nano", lite: "Lite", grok: "Grok", llama: "Llama",
  qwen: "Qwen", qwq: "QwQ", deepseek: "DeepSeek", chat: "Chat", reasoner: "Reasoner", coder: "Coder", mistral: "Mistral",
  mixtral: "Mixtral", codestral: "Codestral", devstral: "Devstral", magistral: "Magistral", small: "Small", medium: "Medium",
  large: "Large", instruct: "Instruct", turbo: "Turbo", versatile: "Versatile", vision: "Vision", kimi: "Kimi", glm: "GLM",
  phi: "Phi", command: "Command", hermes: "Hermes", nemotron: "Nemotron", mini: "mini", it: "IT", preview: "Preview",
  thinking: "Thinking", latest: "", free: "", exp: "", experimental: "", chat_: "",
};

/**
 * "anthropic/claude-sonnet-4-5" → "Claude Sonnet 4.5"; "openai/gpt-4o-mini" → "GPT-4o mini";
 * "qwen3:8b" → "Qwen3 8B"; "meta-llama/Llama-3.3-70B-Instruct-Turbo" → "Llama 3.3 70B Instruct Turbo".
 * An empty id stays empty.
 */
export function modelName(model: string): string {
  const raw = model.trim();
  if (!raw) return "";
  // The last path part is the model; a ":tag" is its size or variant (":latest" says nothing).
  const [base = "", tag = ""] = (raw.split("/").pop() ?? raw).split(":");
  const tokens = base.split(/[-_\s]+/).filter(Boolean);
  const out: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]!;
    const low = t.toLowerCase();
    if (/^\d{6,8}$/.test(t)) continue; // a date stamp (20250514)
    const prev = out.at(-1);
    // "4-5" after a name is a version: 4.5.
    if (/^\d{1,2}$/.test(t) && prev && /^\d{1,2}$/.test(prev) && i > 0 && /^\d{1,2}$/.test(tokens[i - 1]!)) {
      out[out.length - 1] = `${prev}.${t}`;
      continue;
    }
    // GPT keeps its hyphen: GPT-4o, GPT-5.
    if (prev === "GPT" && /^(\d|o\d)/.test(low)) {
      out[out.length - 1] = `GPT-${t}`;
      continue;
    }
    if (low in WORDS) {
      if (WORDS[low]) out.push(WORDS[low]!);
      continue;
    }
    // A family name with its version glued on (qwen3, llama3.1, gemma2) keeps the version.
    const glued = /^([a-z]+)(\d[\d.]*)$/.exec(low);
    if (glued && WORDS[glued[1]!]) {
      out.push(`${WORDS[glued[1]!]}${glued[2]}`);
      continue;
    }
    // Sizes read as sizes: 70b → 70B, 8x7b → 8x7B, a3b stays a code.
    if (/^\d+(\.\d+)?[bmk]$/i.test(t)) {
      out.push(t.toUpperCase());
      continue;
    }
    out.push(/^[a-z]/.test(t) && t.length > 2 && !/\d/.test(t) ? t[0]!.toUpperCase() + t.slice(1) : t);
  }
  const size = tag && tag.toLowerCase() !== "latest" ? (/^\d+(\.\d+)?[bmk]$/i.test(tag) ? tag.toUpperCase() : tag) : "";
  const name = [...out, size].filter(Boolean).join(" ");
  return name || raw;
}
