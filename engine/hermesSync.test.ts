import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { setNodeField } from "../src/board/ydoc";
import { compile } from "../src/compile";
import type { Graph } from "../src/contracts/graph";
import { agentEditable } from "./folders";
import { HermesSync, type HarnessChange } from "./hermesSync";
import { BoardRelay } from "./relay";
import { writeCompileResult } from "./writer";

const fixture = (): Graph => JSON.parse(readFileSync(join(import.meta.dirname, "../test/fixtures/full.graph.json"), "utf8"));

async function setup() {
  const dir = mkdtempSync(join(tmpdir(), "mcbot-sync-"));
  const root = join(dir, "hermes");
  const relay = new BoardRelay(join(dir, "boards"));
  const graph = fixture();
  await relay.create(graph.id, graph.name, graph);
  const changes: HarnessChange[] = [];
  const sync = new HermesSync(root, join(dir, "seen.json"), relay, (c) => changes.push(c));
  // A compile, as the engine does it: write, then remember what McBot wrote.
  const report = await writeCompileResult(compile(await relay.graph(graph.id)), root);
  await sync.remember(report.profiles.map((p) => p.name));
  return { root, relay, sync, changes, id: graph.id };
}

const agent = async (relay: BoardRelay, id: string, nodeId: string) => (await relay.graph(id)).nodes.find((n) => n.id === nodeId)!.data as Record<string, unknown>;

describe("Hermes → the open board", () => {
  it("follows a change made in Hermes, and not McBot's own compile", async () => {
    const { root, relay, sync, changes, id } = await setup();
    expect(await sync.tick()).toEqual([]);

    // Someone edits the researcher's SOUL.md outside McBot (the CLI, an agent, another editor).
    const soul = join(root, "profiles/researcher/SOUL.md");
    writeFileSync(soul, readFileSync(soul, "utf8").replace("Cite every source.", "Cite two sources."));
    const followed = await sync.tick();
    expect(followed).toEqual([{ boardId: id, agent: "researcher", changed: ["soul"] }]);
    expect(changes).toHaveLength(1);
    expect(String((await agent(relay, id, "a1")).soul)).toContain("Cite two sources.");

    // Compiling the board now writes the same SOUL.md: nothing to follow back.
    const report = await writeCompileResult(compile(await relay.graph(id)), root);
    expect(report.changes.find((c) => c.path === "profiles/researcher/SOUL.md")!.status).toBe("unchanged");
    await sync.remember(report.profiles.map((p) => p.name));
    expect(await sync.tick()).toEqual([]);
  });

  it("keeps a board edit not compiled yet when Hermes changes something else", async () => {
    const { root, relay, sync, id } = await setup();
    const room = await relay.room(id);
    setNodeField(room.doc, "a2", "description", "Edited on the board, not compiled");
    const cfg = join(root, "profiles/writer/config.yaml");
    writeFileSync(cfg, readFileSync(cfg, "utf8").replace("  headed: true\n", ""));
    expect((await sync.tick()).map((c) => c.changed)).toEqual([["browser"]]);
    const writer = await agent(relay, id, "a2");
    expect(writer.description).toBe("Edited on the board, not compiled");
    expect(writer.browser).toMatchObject({ show: false });
  });

  it("lets the editor save an agent's settings and workspace, never its memory, logs or keys", () => {
    for (const ok of ["SOUL.md", "config.yaml", "profile.yaml", "skills/triage/SKILL.md", "workspace/notes.md"]) expect(agentEditable(ok)).toBe(true);
    for (const no of ["memories/MEMORY.md", "state.db", ".env", "logs/agent.log", "skills/research/arxiv/SKILL.md", "cron/jobs.json"]) expect(agentEditable(no)).toBe(false);
  });
});
