import { describe, expect, it } from "vitest";
import { classify, parseGitHub, toolName } from "./github";

describe("Add from GitHub", () => {
  it("reads every way people paste a repository", () => {
    expect(parseGitHub("https://github.com/CasperCrypto/mcbot")).toEqual({ owner: "CasperCrypto", repo: "mcbot", ref: null, path: "" });
    expect(parseGitHub("https://github.com/o/r.git")).toEqual({ owner: "o", repo: "r", ref: null, path: "" });
    expect(parseGitHub("https://github.com/o/r/tree/main/skills/research")).toEqual({ owner: "o", repo: "r", ref: "main", path: "skills/research" });
    expect(parseGitHub("https://github.com/o/r/blob/v2/skills/research/SKILL.md")).toEqual({ owner: "o", repo: "r", ref: "v2", path: "skills/research" });
    expect(parseGitHub("git@github.com:o/r.git")).toEqual({ owner: "o", repo: "r", ref: null, path: "" });
    expect(parseGitHub("o/r")).toEqual({ owner: "o", repo: "r", ref: null, path: "" });
    expect(parseGitHub("https://gitlab.com/o/r")).toBeNull();
    expect(parseGitHub("https://github.com/o")).toBeNull();
    // A link's ".." is resolved before it is read: it never reaches outside the repository.
    expect(parseGitHub("https://github.com/o/r/tree/main/../../x")).toEqual({ owner: "o", repo: "r", ref: null, path: "" });
    expect(parseGitHub("https://github.com/o/r/tree/main/%2e%2e/%2e%2e/x")?.path ?? "").not.toContain("..");
    expect(parseGitHub("hello world")).toBeNull();
  });

  it("says what a repository is from its files", () => {
    const ref = { owner: "o", repo: "weather-mcp-server", ref: "main", path: "" };
    expect(classify({ ...ref, path: "skills/x" }, ["SKILL.md", "notes.md"], null, null)).toMatchObject({ kind: "skill", source: "https://github.com/o/weather-mcp-server/tree/main/skills/x" });
    expect(classify(ref, ["plugin.yaml", "__init__.py"], null, null)).toMatchObject({ kind: "plugin", source: "o/weather-mcp-server" });
    expect(classify(ref, ["package.json"], { name: "@acme/weather-mcp", dependencies: { "@modelcontextprotocol/sdk": "^1" } }, null))
      .toMatchObject({ kind: "mcp", mcp: { name: "weather", command: "npx", args: ["-y", "@acme/weather-mcp"] } });
    expect(classify(ref, ["package.json"], { name: "x", private: true, keywords: ["mcp"] }, null)).toMatchObject({ kind: "mcp", mcp: { args: ["-y", "github:o/weather-mcp-server"] } });
    const py = '[project]\nname = "weather-tools"\ndependencies = ["mcp>=1.2", "httpx"]\n\n[project.scripts]\nweather-server = "weather.main:run"\n';
    expect(classify(ref, ["pyproject.toml"], null, py)).toMatchObject({ kind: "mcp", mcp: { command: "uvx", args: ["--from", "git+https://github.com/o/weather-mcp-server", "weather-server"] } });
    expect(classify(ref, ["README.md", "src"], { name: "app", dependencies: { react: "19" } }, '[project]\nname = "x"\ndependencies = ["requests"]')).toMatchObject({ kind: "project" });
    expect(toolName("GitHub-MCP-Server")).toBe("github");
    expect(toolName("mcp-server-fetch")).toBe("fetch");
  });
});
