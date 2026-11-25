import { appendFileSync } from "node:fs";
import { startStubLlm, type ChatRequest } from "./server";

const port = Number(process.env.STUB_LLM_PORT ?? 11500);
const log = process.env.STUB_LLM_LOG;
/** The system prompt Hermes sent, as text. */
const systemText = (req: ChatRequest) => (req.messages ?? []).filter((m) => m.role === "system").map((m) => (typeof m.content === "string" ? m.content : JSON.stringify(m.content ?? ""))).join("\n");
// Each request in one line; `where` and `guide` say whether the agent's prompt told it where it works and listed
// McBot's guide (src/compile/soul.ts, mcbotGuide.ts), which scripts/smoke.mjs checks on every platform.
const stub = await startStubLlm(port, "127.0.0.1", log ? (req) => {
  const sys = systemText(req);
  appendFileSync(log, `${JSON.stringify({ model: req.model, stream: req.stream, tools: (req.tools ?? []).map((t) => t.function?.name), last: req.messages?.at(-1)?.role, where: sys.includes("## Where you work"), guide: sys.includes("mcbot-studio") })}\n`);
} : undefined);
console.log(`stub-llm listening on ${stub.url} (model id: anything)`);
