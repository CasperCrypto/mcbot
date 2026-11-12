import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { addMessage, graphFromDoc, loadGraphIntoDoc } from "../../board/ydoc";
import { GRAPH_SCHEMA, MESSAGES_KEPT, type AgentNode } from "../../contracts/graph";
import { mentionOf } from "../lib/mention";

const agent = (name: string, displayName = ""): AgentNode => ({ id: `a-${name}`, kind: "agent", position: { x: 0, y: 0 }, data: { name, displayName, description: "", soul: "", skills: [], capabilities: null } });

describe("team chat", () => {
  it("finds the agent a message asks, by ID or by name", () => {
    const agents = [agent("triage", "Triage desk"), agent("researcher")];
    expect(mentionOf("@triage how many tickets?", agents)?.agent.data.name).toBe("triage");
    expect(mentionOf("@TriageDesk: summarise", agents)).toMatchObject({ prompt: "summarise" });
    expect(mentionOf("hey @triage", agents)).toBeNull();
    expect(mentionOf("@nobody hi", agents)).toBeNull();
  });

  it("keeps messages in the board, in order, and drops the oldest past the limit", () => {
    const doc = new Y.Doc();
    loadGraphIntoDoc(doc, { schema: GRAPH_SCHEMA, id: "b", name: "b", nodes: [], edges: [] });
    for (let i = 0; i < MESSAGES_KEPT + 5; i++) addMessage(doc, { id: `m${i}`, author: "Ada", color: "", agent: "", text: `#${i}`, at: 1000 + i });
    const g = graphFromDoc(doc);
    expect(g.messages).toHaveLength(MESSAGES_KEPT);
    expect(g.messages![0]!.text).toBe("#5");
    // A board file round-trips its chat.
    const again = new Y.Doc();
    loadGraphIntoDoc(again, g);
    expect(graphFromDoc(again).messages).toEqual(g.messages);
  });
});
