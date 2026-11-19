import { describe, expect, it } from "vitest";
import type { ModelNode } from "../src/contracts/graph";
import { askForPlan, PlanError, plannerModel } from "./builder";

const local = { id: "m", kind: "model", position: { x: 0, y: 0 }, data: { name: "local", label: "Ollama", endpoint: "local", baseUrl: "http://127.0.0.1:11434/v1/", model: "qwen3:8b", apiKeyEnv: "" } } as unknown as ModelNode;
const cloud = { ...local, data: { ...local.data, endpoint: "cloud", apiKeyEnv: "OPENROUTER_API_KEY", label: "OpenRouter" } } as unknown as ModelNode;
const choices = { tools: [{ id: "exa", does: "web search" }], chatApps: ["slack"], skills: [] };
const answer = (content: string) => (async (url: string | URL | Request, init?: RequestInit) => {
  seen.push({ url: String(url), body: JSON.parse(String(init?.body)), auth: (init?.headers as Record<string, string>)?.authorization });
  return new Response(JSON.stringify({ choices: [{ message: { content } }] }));
}) as typeof fetch;
let seen: { url: string; body: { model: string; messages: { role: string; content: string }[] }; auth?: string }[] = [];

describe("Ask McBot in the engine", () => {
  it("asks the board's model on its OpenAI-compatible endpoint and keeps only allowed ids", async () => {
    seen = [];
    const plan = await askForPlan(local, undefined, "a support team on slack", choices, answer('{"agents":[{"name":"Support","tools":["exa","nope"],"chatApps":["slack"]}]}'));
    expect(seen[0]!.url).toBe("http://127.0.0.1:11434/v1/chat/completions");
    expect(seen[0]!.body.model).toBe("qwen3:8b");
    expect(seen[0]!.body.messages[0]!.content).toContain("exa (web search)");
    expect(seen[0]!.auth).toBeUndefined();
    expect(plan.agents[0]).toMatchObject({ name: "Support", tools: ["exa"], chatApps: ["slack"] });
  });
  it("sends a cloud model's key, and refuses without one", async () => {
    seen = [];
    await askForPlan(cloud, "sk-test", "x y z", choices, answer('{"agents":[{"name":"A"}]}'));
    expect(seen[0]!.auth).toBe("Bearer sk-test");
    await expect(askForPlan(cloud, undefined, "x y z", choices, answer("{}"))).rejects.toThrow(/Save the key/);
  });
  it("says so when the answer isn't a plan", async () => {
    await expect(askForPlan(local, undefined, "x y z", choices, answer("Sure! Here are some ideas."))).rejects.toBeInstanceOf(PlanError);
  });
  it("plans with the model of the board's first agent", () => {
    const graph = { schema: "mcbot.graph/v1", id: "b", name: "B", nodes: [cloud, { ...local, id: "m2" }, { id: "a", kind: "agent", position: { x: 0, y: 0 }, data: { name: "a" } }], edges: [{ id: "e", source: "m2", target: "a", order: 0 }] } as never;
    expect(plannerModel(graph)?.id).toBe("m2");
  });
});
