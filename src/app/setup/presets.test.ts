import { describe, expect, it } from "vitest";
import { compile, resolveGraph } from "../../compile";
import type { SetupProfile } from "../../contracts/api";
import { boardName, buildTeam, defaultPicks, presetsFor, userFacts, type ModelChoice } from "./presets";

const company: SetupProfile = { kind: "company", name: "Maya", company: "Acme", about: "Invoicing software for small shops.", role: "Head of support" };
const personal: SetupProfile = { kind: "personal", name: "Kai", company: "", about: "plan my week, answer email", role: "" };
const local: ModelChoice = { endpoint: "local", label: "Ollama", baseUrl: "http://127.0.0.1:11434/v1", model: "qwen3:8b", apiKeyEnv: "" };
const cloud: ModelChoice = { endpoint: "cloud", label: "OpenRouter", baseUrl: "https://openrouter.ai/api/v1", model: "some/model", apiKeyEnv: "OPENROUTER_API_KEY" };

describe("setup presets", () => {
  it("offers personal and company teams with sensible defaults", () => {
    expect(presetsFor("personal").map((p) => p.id)).not.toContain("support");
    expect(defaultPicks("personal")).toEqual(["assistant", "researcher"]);
    expect(defaultPicks("company")).toEqual(["support", "researcher", "sales"]);
  });

  it("builds a board that compiles, local first and cloud as its fallback", () => {
    const g = buildTeam(company, defaultPicks("company"), [local, cloud], "/Users/maya/McBot");
    const { bundles, issues } = resolveGraph(g);
    expect(issues.filter((i) => i.level === "error")).toEqual([]);
    expect(bundles.map((b) => [b.agent.data.name, b.models.map((m) => m.data.name)])).toEqual([
      ["researcher", ["local", "cloud"]], ["sales", ["local", "cloud"]], ["support", ["local", "cloud"]],
    ]);
    const files = compile(g).files.map((f) => f.path);
    expect(files).toContain("profiles/support/SOUL.md");
    const soul = compile(g).files.find((f) => f.path === "profiles/support/SOUL.md")!.content;
    expect(soul).toContain("You work at Acme. Invoicing software for small shops.");
    expect(soul).toContain("You report to Maya, Head of support.");
    expect(g.name).toBe("Acme");
  });

  it("writes who the user is into memory facts and names the board", () => {
    expect(userFacts(company)).toBe("The user is Maya, Head of support at Acme. Acme: Invoicing software for small shops.");
    expect(userFacts(personal)).toBe("The user is Kai. Wants help with: plan my week, answer email.");
    expect(boardName(personal)).toBe("Kai's agents");
    const g = buildTeam(personal, ["assistant"], [cloud], "/home/kai/McBot");
    expect(resolveGraph(g).issues.filter((i) => i.level === "error")).toEqual([]);
  });
});
