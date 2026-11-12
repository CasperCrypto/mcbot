import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { compile } from "../compile";
import type { CompileResult } from "../contracts/compile";
import type { Graph } from "../contracts/graph";
import { mergeConfig } from "./merge";
import type { ProfileFiles } from "./read";
import { applyEdits, followChanges, reconcile } from "./reconcile";

const FIXTURES = join(import.meta.dirname, "../../test/fixtures");
const boards = readdirSync(FIXTURES).filter((f) => f.endsWith(".graph.json"));
const load = (name: string): Graph => JSON.parse(readFileSync(join(FIXTURES, name), "utf8"));

function filesOf(result: CompileResult, name: string): ProfileFiles {
  const dir = `profiles/${name}`;
  const at = (p: string) => result.files.find((f) => f.path === p)?.content ?? null;
  const skills = Object.fromEntries(result.files.filter((f) => f.path.startsWith(`${dir}/skills/`)).map((f) => [f.path.split("/")[3]!, f.content]));
  return { name, config: at(`${dir}/config.yaml`), soul: at(`${dir}/SOUL.md`), profileYaml: at(`${dir}/profile.yaml`), skills };
}

/** Change one agent's files the way a person or Hermes would, follow it on the board, compile again. */
function follow(graph: Graph, name: string, change: (f: ProfileFiles) => ProfileFiles) {
  const before = compile(graph);
  const edited = change(filesOf(before, name));
  const { edits, changed } = reconcile(graph, edited);
  const next = applyEdits(graph, edits);
  const after = filesOf(compile(next), name);
  return { edits, changed, edited, after, next };
}
const body = (cfg: string | null) => (cfg ?? "").replace(/^(#.*\n)*/, "");

describe("Hermes → board", () => {
  it.each(boards)("%s: an agent whose files match the board needs no edits", (name) => {
    const graph = load(name);
    const result = compile(graph);
    for (const p of result.profiles) expect(reconcile(graph, filesOf(result, p.name)).edits).toEqual([]);
  });

  it("follows a SOUL.md edit, keeping the hand-off section to compile", () => {
    const graph = load("full.graph.json");
    const { changed, edited, after } = follow(graph, "researcher", (f) => ({ ...f, soul: f.soul!.replace("Cite every source.", "Cite two sources for every claim.") }));
    expect(changed).toEqual(["soul"]);
    expect(after.soul).toBe(edited.soul);
  });

  it("follows a model change in config.yaml", () => {
    const graph = load("three-node.graph.json");
    const { changed, after, edited } = follow(graph, "triage", (f) => ({ ...f, config: f.config!.replaceAll("qwen3:8b", "qwen3:14b") }));
    expect(changed).toEqual(["model"]);
    expect(body(after.config)).toBe(body(edited.config));
  });

  it("adds a tool Hermes gained, and unwires one it lost", () => {
    const graph = load("three-node.graph.json");
    const added = follow(graph, "triage", (f) => ({ ...f, config: f.config!.replace("mcp_servers:\n", "mcp_servers:\n  git:\n    command: uvx\n    args:\n      - mcp-server-git\n") }));
    expect(added.edits.map((e) => e.op)).toEqual(expect.arrayContaining(["add-node", "add-edge"]));
    expect(mergeConfig(added.edited.config, compile(added.next).files.find((f) => f.path === "profiles/triage/config.yaml")!.content)).toBe(
      mergeConfig(added.edited.config, added.after.config!),
    );
    expect(added.after.config).toContain("git:\n    command: uvx");
    // And back: the person removes the server again.
    const removed = follow(added.next, "triage", (f) => ({ ...f, config: f.config!.replace(/  git:\n    command: uvx\n    args:\n      - mcp-server-git\n/, "") }));
    expect(removed.edits.some((e) => e.op === "remove-edges")).toBe(true);
    expect(removed.after.config).not.toContain("git:");
  });

  it("follows abilities and the browser", () => {
    const graph = load("full.graph.json");
    const { changed, after } = follow(graph, "writer", (f) => ({ ...f, config: f.config!.replace(/  cli:\n    - web\n/, "  cli:\n").replace(/  api_server:\n    - web\n/, "  api_server:\n").replace("  headed: true\n", "") }));
    expect(changed.sort()).toEqual(["abilities", "browser"]);
    expect(after.config).not.toContain("- web");
    expect(after.config).not.toContain("headed");
  });

  it("follows a hand-off removed from the Team section", () => {
    const graph = load("full.graph.json");
    const { changed, after, next } = follow(graph, "researcher", (f) => ({ ...f, soul: f.soul!.replace(/\n\n## Team[\s\S]*$/, "\n") }));
    expect(changed).toContain("team");
    expect(after.soul).not.toContain("## Team");
    expect(next.edges.some((e) => e.source === "a1" && e.target === "a2")).toBe(false);
  });

  it("keeps a board edit not compiled yet when Hermes changes something else", () => {
    const graph = load("full.graph.json");
    const base = filesOf(compile(graph), "researcher");
    // On the board (not compiled): a new soul. In Hermes: the model's id changed.
    const board = applyEdits(graph, [{ op: "set", id: "a1", field: "soul", value: "Board soul." }]);
    const now = { ...base, config: base.config!.replaceAll("frontier-1", "frontier-2") };
    const { edits, changed } = followChanges(board, base, now);
    expect(changed).toEqual(["model"]);
    expect(edits.some((e) => e.op === "set" && e.field === "soul")).toBe(false);
  });

  it("leaves the board alone while config.yaml does not parse", () => {
    const graph = load("three-node.graph.json");
    const files = filesOf(compile(graph), "triage");
    expect(reconcile(graph, { ...files, config: `${files.config}mcp_servers:\n  oops: [\n` }).edits).toEqual([]);
  });

  it("leaves the board alone for an agent it does not have", () => {
    expect(reconcile(load("three-node.graph.json"), { name: "nobody", config: "a: 1\n", soul: "# x\n", profileYaml: null, skills: {} }).edits).toEqual([]);
  });
});
