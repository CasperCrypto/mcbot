/**
 * Names McBot shows for things Hermes names in kebab-case (skills, their categories, plugins):
 * sentence case, as macOS labels are, with acronyms and brands spelled their own way.
 * "antigravity-cli" → "Antigravity CLI", "autonomous-ai-agents" → "Autonomous AI agents".
 */
const SPELLING: Record<string, string> = {
  "1password": "1Password", agentmail: "AgentMail", ai: "AI", api: "API", apis: "APIs", arxiv: "arXiv", ascii: "ASCII", ast: "AST",
  aws: "AWS", bci: "BCI", claude: "Claude", cli: "CLI", cloudflare: "Cloudflare", codex: "Codex", comfyui: "ComfyUI", cpp: "C++",
  crm: "CRM", csv: "CSV", dcf: "DCF", devops: "DevOps", docker: "Docker", dom: "DOM", dspy: "DSPy", evm: "EVM", excalidraw: "Excalidraw",
  excel: "Excel", faiss: "FAISS", fastmcp: "FastMCP", findmy: "Find My", fsdp: "FSDP", gcp: "GCP", gif: "GIF", github: "GitHub",
  gitlab: "GitLab", gitnexus: "GitNexus", google: "Google", graphql: "GraphQL", har: "HAR", hermes: "Hermes", html: "HTML", http: "HTTP",
  hyperliquid: "Hyperliquid", imessage: "iMessage", ios: "iOS", ip: "IP", json: "JSON", jupyter: "Jupyter", lbo: "LBO", linkedin: "LinkedIn",
  llm: "LLM", llms: "LLMs", macos: "macOS", manim: "Manim", mcp: "MCP", md: "MD", microsoft: "Microsoft", minecraft: "Minecraft",
  ml: "ML", mlops: "MLOps", nemo: "NeMo", nft: "NFT", nfts: "NFTs", notion: "Notion", npm: "npm", oauth: "OAuth", obsidian: "Obsidian",
  ocr: "OCR", openai: "OpenAI", opencode: "OpenCode", openhands: "OpenHands", openhue: "OpenHue", osint: "OSINT", oss: "OSS",
  p5js: "p5.js", pdf: "PDF", pdfs: "PDFs", peft: "PEFT", pokemon: "Pokémon", polymarket: "Polymarket", pptx: "PPTX", pr: "PR", prs: "PRs",
  python: "Python", pytorch: "PyTorch", qa: "QA", qmd: "QMD", reddit: "Reddit", rest: "REST", rss: "RSS", saelens: "SAELens",
  sdlc: "SDLC", seo: "SEO", simpo: "SimPO", siyuan: "SiYuan", slack: "Slack", solana: "Solana", sql: "SQL", ssh: "SSH", stripe: "Stripe",
  stt: "STT", svg: "SVG", telegram: "Telegram", tensorrt: "TensorRT", tiktok: "TikTok", torchtitan: "TorchTitan", tts: "TTS",
  ui: "UI", unreal: "Unreal", url: "URL", urls: "URLs", ux: "UX", vllm: "vLLM", whatsapp: "WhatsApp", xai: "xAI", yaml: "YAML",
  youtube: "YouTube",
};

/** Hermes' category folders, where a plain word would mislead. */
const CATEGORY: Record<string, string> = {
  dogfood: "Testing",
  mcp: "MCP servers",
  web: "Web",
};

const words = (raw: string) => raw.trim().split(/[\s_-]+/).filter(Boolean);

/** "antigravity-cli" → "Antigravity CLI"; "github-pr-review" → "GitHub PR review". */
export function prettyName(raw: string): string {
  return words(raw).map((w, i) => {
    const k = w.toLowerCase();
    if (SPELLING[k]) return SPELLING[k];
    if (i > 0) return /[A-Z]/.test(w.slice(1)) ? w : k;
    return w.charAt(0).toUpperCase() + w.slice(1);
  }).join(" ");
}

/** A skill category's label: "autonomous-ai-agents" → "Autonomous AI agents", "mcp" → "MCP servers". */
export function categoryName(raw: string): string {
  return CATEGORY[raw.toLowerCase()] ?? prettyName(raw);
}
