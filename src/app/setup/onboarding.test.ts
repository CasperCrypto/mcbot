import { describe, expect, it } from "vitest";
import { compile, resolveGraph } from "../../compile";
import type { SetupProfile } from "../../contracts/api";
import { GOALS, HUGGING_FACE, briefFromSetup, buildSetupBoard, emptyAnswers, listed, memberKey, setupNeeds, teamsFor, toggleListed } from "./onboarding";
import type { ModelChoice } from "./presets";
import { TEAMS } from "../graph/teams";

const company: SetupProfile = { kind: "company", name: "Maya", company: "Northwind Bakery", about: "Sourdough and pastries, baked daily.", role: "Owner" };
const cloud: ModelChoice = { endpoint: "cloud", label: "OpenRouter", baseUrl: "https://openrouter.ai/api/v1", model: "some/model", apiKeyEnv: "OPENROUTER_API_KEY" };
const local: ModelChoice = { endpoint: "local", label: "Ollama", baseUrl: "http://127.0.0.1:11434/v1", model: "qwen3:8b", apiKeyEnv: "" };

describe("onboarding", () => {
  it("turns the answers into the brief every agent knows", () => {
    const brief = briefFromSetup(company, { ...emptyAnswers(), customers: "Local families", goals: "Sell out by noon", voice: "Warm", channels: "Instagram, Newsletter" });
    expect(brief).toMatchObject({ who: "Northwind Bakery. Maya, Owner leads the agents", what: "Sourdough and pastries, baked daily.", customers: "Local families", goals: "Sell out by noon", voice: "Warm", channels: "Instagram, Newsletter", notes: "" });
    expect(briefFromSetup({ ...company, kind: "personal" }, emptyAnswers()).who).toBe("Maya");
  });

  it("answers every goal with a starter team", () => {
    for (const g of GOALS) expect(TEAMS.some((t) => t.id === g.team), g.id).toBe(true);
    expect(teamsFor(["sales", "social", "social"]).map((t) => t.id)).toEqual(["social", "sales"]);
  });

  it("builds a social media team whose designer makes images on the cloud model's key, and every agent knows the business", () => {
    const brief = briefFromSetup(company, { ...emptyAnswers(), channels: "Instagram" });
    const teams = teamsFor(["social"]);
    expect(setupNeeds(teams)).toEqual({ image: true, video: false, web: true });
    const { graph, lead, skills } = buildSetupBoard({ profile: company, brief, teams, models: [local, cloud], workspace: "/Users/maya/McBot" });
    const { bundles, issues } = resolveGraph(graph);
    expect(issues.filter((i) => i.level === "error")).toEqual([]);
    expect(bundles.map((b) => b.agent.data.name).sort()).toEqual(["designer", "marketing", "social"]);
    expect(bundles.every((b) => b.models.map((m) => m.data.name).join() === "local,cloud")).toBe(true);
    expect(bundles.find((b) => b.agent.data.name === "designer")!.image?.data.provider).toBe("openrouter");
    expect(bundles.find((b) => b.agent.data.name === "marketing")!.tools.map((t) => t.data.name).sort()).toEqual(["exa", "files"]);
    expect(graph.nodes.find((n) => n.id === lead)?.data).toMatchObject({ name: "marketing" });
    expect(skills.map((s) => s.profile)).toContain("marketing");
    const souls = compile(graph).files.filter((f) => f.path.endsWith("SOUL.md"));
    expect(souls).toHaveLength(3);
    for (const f of souls) expect(f.content).toContain("**Who:** Northwind Bakery");
    expect(graph.name).toBe("Northwind Bakery");
  });

  it("leaves out the members unticked, and uses the maker service picked", () => {
    const teams = teamsFor(["social", "sales"]);
    const social = teams[0]!;
    const { graph } = buildSetupBoard({ profile: company, brief: briefFromSetup(company, emptyAnswers()), teams, skip: new Set([memberKey(social, "social")]), models: [cloud], workspace: "/w", maker: "fal" });
    const { bundles, issues } = resolveGraph(graph);
    expect(issues.filter((i) => i.level === "error")).toEqual([]);
    expect(bundles.map((b) => b.agent.data.name).sort()).toEqual(["designer", "marketing", "outreach", "prospector"]);
    expect(bundles.find((b) => b.agent.data.name === "designer")!.image?.data.provider).toBe("fal");
    expect(bundles.find((b) => b.agent.data.name === "marketing")!.team.map((t) => t.data.name)).toEqual(["designer"]);
  });

  it("edits comma lists as chips", () => {
    expect(toggleListed("Instagram, LinkedIn", "linkedin")).toBe("Instagram");
    expect(toggleListed("", "TikTok")).toBe("TikTok");
    expect(listed("Instagram, TikTok", "tiktok")).toBe(true);
  });
  it("makes pictures through Hugging Face's connector instead of a maker when that is the choice", () => {
    const { graph } = buildSetupBoard({ profile: company, brief: briefFromSetup(company, emptyAnswers()), teams: teamsFor(["social"]), models: [local], workspace: "/w", maker: HUGGING_FACE });
    const { bundles, issues } = resolveGraph(graph);
    expect(issues.filter((i) => i.level === "error")).toEqual([]);
    const designer = bundles.find((b) => b.agent.data.name === "designer")!;
    expect(designer.image).toBeNull();
    expect(designer.tools.map((t) => t.data.name)).toContain("hugging_face");
    expect(graph.nodes.filter((n) => n.kind === "media")).toHaveLength(0);
  });
});
