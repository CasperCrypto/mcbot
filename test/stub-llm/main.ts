import { appendFileSync } from "node:fs";
import { startStubLlm } from "./server";

const port = Number(process.env.STUB_LLM_PORT ?? 11500);
const log = process.env.STUB_LLM_LOG;
const stub = await startStubLlm(port, "127.0.0.1", log ? (req) => appendFileSync(log, `${JSON.stringify({ model: req.model, stream: req.stream, tools: (req.tools ?? []).map((t) => t.function?.name), last: req.messages?.at(-1)?.role })}\n`) : undefined);
console.log(`stub-llm listening on ${stub.url} (model id: anything)`);
