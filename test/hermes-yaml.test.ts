/**
 * Cross-check against the real parser: every YAML file the compiler emits is
 * loaded with Hermes' own `hermes_yaml.safe_load` (ruamel, YAML 1.1) and must
 * mean exactly what McBot intended. Opt-in: needs Hermes' environment.
 *
 *   MCBOT_E2E=1 npm test                         McBot's own hermes/ (after npm run hermes:setup)
 *   MCBOT_HERMES_SRC=/path/to/hermes-agent npm test   another checkout
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { compile } from "../src/compile";

const SRC = process.env.MCBOT_HERMES_SRC || (process.env.MCBOT_E2E === "1" ? join(import.meta.dirname, "..", "hermes") : undefined);

function hermesLoad(docs: string[]): unknown[] {
  const py = [
    "import json, sys",
    `sys.path.insert(0, ${JSON.stringify(SRC)})`,
    "from hermes_yaml import safe_load",
    "docs = json.load(sys.stdin)",
    "print(json.dumps([safe_load(d) for d in docs], default=str))",
  ].join("\n");
  const out = execFileSync(join(SRC!, "scripts", "run-in-hermes-env"), ["python3", "-c", py], {
    input: JSON.stringify(docs),
    encoding: "utf8",
    stdio: ["pipe", "pipe", "ignore"],
    timeout: 300_000,
  });
  return JSON.parse(out.trim().split("\n").at(-1)!);
}

describe.skipIf(!SRC)("Hermes reads compiled YAML exactly as intended", () => {
  it("config.yaml, profile.yaml and SKILL.md frontmatter round-trip through hermes_yaml.safe_load", () => {
    const graph = JSON.parse(readFileSync(join(import.meta.dirname, "fixtures/full.graph.json"), "utf8"));
    const files = compile(graph).files.filter((f) => /\.(yaml)$|SKILL\.md$/.test(f.path));
    const docs = files.map((f) => (f.path.endsWith("SKILL.md") ? f.content.split("---\n")[1]! : f.content));
    const loaded = hermesLoad(docs);
    docs.forEach((d, i) => expect(loaded[i], files[i]!.path).toEqual(parse(d, { version: "1.1" })));

    const researcher = loaded[files.findIndex((f) => f.path === "profiles/researcher/config.yaml")] as Record<string, any>;
    expect(researcher.model).toEqual({ provider: "custom:mcbot-cloud", default: "frontier-1" });
    expect(researcher.providers["mcbot-local"].default_model).toBe("on"); // a string, not True
    expect(researcher.mcp_servers.git.args).toEqual(["mcp-server-git", "--repository", "yes"]);
    expect(researcher.mcp_servers.git.env.ALPHA).toBe("0755"); // not octal 493
  }, 300_000);
});
