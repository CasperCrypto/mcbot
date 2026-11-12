import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { CompileResult } from "../contracts/compile";
import { compile } from "../compile";
import { readHermes, readSkill, splitSoul, type ProfileFiles } from "./read";

const FIXTURES = join(import.meta.dirname, "../../test/fixtures");
const graphs = readdirSync(FIXTURES).filter((f) => f.endsWith(".graph.json"));

/** A compiled setup as the engine would read it from disk. */
function asProfiles(result: CompileResult): ProfileFiles[] {
  const at = (p: string) => result.files.find((f) => f.path === p)?.content ?? null;
  return result.profiles.map(({ name, dir }) => ({
    name,
    config: at(`${dir}/config.yaml`),
    soul: at(`${dir}/SOUL.md`),
    profileYaml: at(`${dir}/profile.yaml`),
    skills: Object.fromEntries(
      result.files.filter((f) => f.path.startsWith(`${dir}/skills/`) && f.path.endsWith("/SKILL.md")).map((f) => [f.path.split("/")[3]!, f.content]),
    ),
  }));
}

/** Hermes' files, without compile's header comment (it names the board and node ids). */
function hermesFiles(result: CompileResult): Record<string, string> {
  return Object.fromEntries(
    result.files
      .filter((f) => f.role !== "manifest" && f.role !== "marker")
      .map((f) => [f.path, f.role === "config" ? f.content.replace(/^(#.*\n)+/, "") : f.content]),
  );
}

describe("Hermes setup → board", () => {
  it.each(graphs)("%s: compile, read back, compile again gives the same Hermes files", (name) => {
    const first = compile(JSON.parse(readFileSync(join(FIXTURES, name), "utf8")));
    const { graph, unshown } = readHermes({ id: first.graphId, name: "read" }, asProfiles(first));
    expect(unshown).toEqual([]);
    expect(hermesFiles(compile(graph))).toEqual(hermesFiles(first));
  });

  it("lists what it cannot show yet instead of dropping it silently", () => {
    const { graph, unshown } = readHermes({ id: "mine", name: "Mine" }, [{
      name: "helper",
      config: "model:\n  provider: openrouter\n  default: some/model\nmemory:\n  provider: honcho\nplatform_toolsets:\n  cli:\n    - web\n    - homeassistant\n",
      soul: "# Helper\n",
      profileYaml: null,
      skills: { research: "not a skill file" },
    }]);
    expect(graph.nodes.map((n) => n.kind)).toEqual(["agent"]);
    expect(unshown.map((u) => u.what)).toEqual(["config.yaml: memory", "skills/research", "model openrouter", "platform_toolsets.cli: homeassistant"]);
    expect((graph.nodes[0]!.data as { capabilities: string[] }).capabilities).toEqual(["web"]);
  });

  it("splits the compiled Team section from the agent's own words", () => {
    const soul = "# Lead\n\nRuns the desk.\n\n## Team\n\nYou can hand work to these agents.\n\n- `writer` (Writer): drafts\n- `editor`";
    expect(splitSoul(soul)).toEqual({ own: "# Lead\n\nRuns the desk.", team: ["writer", "editor"] });
    expect(splitSoul("# Solo")).toEqual({ own: "# Solo", team: [] });
  });

  it("reads a SKILL.md the board can hold, and refuses one it cannot", () => {
    expect(readSkill("---\nname: triage\ndescription: Sort tickets\nversion: 1.2.0\n---\n\nBody\n")).toMatchObject({ name: "triage", version: "1.2.0", body: "Body" });
    expect(readSkill("---\nname: Bad Name\ndescription: x\n---\n")).toBeNull();
  });
});
