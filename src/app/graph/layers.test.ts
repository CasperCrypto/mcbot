import { describe, expect, it } from "vitest";
import { resolveGraph } from "../../compile";
import { harnessLayers } from "./layers";

const graph = (agent: Record<string, unknown>, withModel = true) => ({
  schema: "mcbot.graph/v1", id: "b", name: "B",
  nodes: [
    { id: "m", kind: "model", position: { x: 0, y: 0 }, data: { name: "local", label: "Ollama", endpoint: "local", baseUrl: "http://127.0.0.1:11434/v1", model: "qwen3:8b" } },
    { id: "a", kind: "agent", position: { x: 0, y: 0 }, data: { name: "a", soul: "Be brief.\nCite sources.", ...agent } },
    { id: "w", kind: "agent", position: { x: 0, y: 0 }, data: { name: "w", displayName: "Writer" } },
  ],
  edges: [...(withModel ? [{ id: "e1", source: "m", target: "a" }] : []), { id: "e2", source: "m", target: "w" }, { id: "e3", source: "a", target: "w" }],
});
const bundle = (g: ReturnType<typeof graph>) => resolveGraph(g).bundles.find((b) => b.agent.id === "a")!;

describe("harness layers", () => {
  it("lists the seven layers outside in", () => {
    expect(harnessLayers(bundle(graph({}))).map((l) => l.id)).toEqual(["surfaces", "loop", "context", "model", "tools", "plugins", "guardrails"]);
  });
  it("shows what the board sets and what Hermes defaults", () => {
    const layers = harnessLayers(bundle(graph({ maxSteps: 30, dailyBudgetUsd: 2 })), { schedules: [], plugins: [{ name: "advisor", enabled: true, version: "1", summary: "", source: "git" }] });
    const item = (layer: string, label: string) => layers.find((l) => l.id === layer)!.items.find((i) => i.label === label)!;
    expect(item("loop", "Steps per message")).toMatchObject({ detail: "Up to 30", state: "set" });
    expect(item("loop", "Hands work to")).toMatchObject({ detail: "Writer", state: "set" });
    expect(item("context", "Identity").detail).toBe("2 lines in SOUL.md");
    expect(item("model", "Ollama")).toMatchObject({ detail: "qwen3:8b · on this computer", target: { node: "m" } });
    expect(item("plugins", "Plugins").detail).toBe("advisor");
    expect(item("guardrails", "Daily budget").detail).toBe("$2 a day");
    expect(harnessLayers(bundle(graph({}))).find((l) => l.id === "loop")!.items[0]).toMatchObject({ state: "default", detail: "No limit (Hermes' default)" });
  });
  it("says how careful the agent is, and changes it in the row", () => {
    const care = (approvals?: string) => harnessLayers(bundle(graph(approvals ? { approvals } : {}))).find((l) => l.id === "guardrails")!.items.find((i) => i.label === "Approvals")!;
    expect(care()).toMatchObject({ state: "default", edit: "approvals", detail: "Asks you when its safety check isn't sure (Hermes' default)" });
    expect(care("manual")).toMatchObject({ state: "set", detail: "Asks you before every risky command" });
    expect(care("off")).toMatchObject({ state: "set", detail: "Never asks: runs risky commands itself" });
  });
  it("marks what it can't work without", () => {
    const layers = harnessLayers(bundle(graph({ soul: "" }, false)));
    expect(layers.find((l) => l.id === "model")!.items[0]!.state).toBe("missing");
    expect(layers.find((l) => l.id === "context")!.items[0]!.state).toBe("missing");
  });
});
