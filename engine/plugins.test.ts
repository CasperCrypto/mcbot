import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PLUGIN_NAME_RE, enablePluginArgv, firstSentence, installPluginArgv, listPluginCatalog, parsePluginList } from "./plugins";

const HERMES = join(import.meta.dirname, "../hermes");

describe("Hermes plugins", () => {
  it("reads the curated catalog from the engine's own files", () => {
    const cat = listPluginCatalog(HERMES);
    expect(cat.length).toBeGreaterThan(1000);
    const a = cat.find((p) => p.name === "abeyance")!;
    expect(a).toMatchObject({ title: "Abeyance", category: "automation", tier: "community", maintainer: "0xkinno", platforms: ["linux"], hooks: 5, tools: 0 });
    expect(a.summary).toBe("Your Hermes cron jobs wait for you instead of guessing.");
    for (const p of cat) expect(p.name).toMatch(PLUGIN_NAME_RE);
  });

  it("parses `plugins list --json` (what Hermes v0.23.2 printed for an installed catalog plugin)", () => {
    const out = 'Loading…\n[{"name":"abeyance","status":"enabled","version":"0.1.4","description":"A Hermes cron run that waits for you. More.","source":"catalog:community@a005208a","removed":null},{"name":"chronos","status":"not enabled","version":"1.0.0","description":"x","source":"bundled","removed":null}]';
    expect(parsePluginList(out)).toEqual([
      { name: "abeyance", enabled: true, version: "0.1.4", summary: "A Hermes cron run that waits for you.", source: "catalog:community@a005208a" },
      { name: "chronos", enabled: false, version: "1.0.0", summary: "x", source: "bundled" },
    ]);
    expect(parsePluginList("no json")).toEqual([]);
  });

  it("runs Hermes' commands without a prompt", () => {
    expect(installPluginArgv("abeyance")).toEqual(["plugins", "install", "abeyance", "--enable", "--yes-deps"]);
    expect(enablePluginArgv("abeyance")).toEqual(["plugins", "enable", "abeyance", "--no-allow-tool-override"]);
    expect(PLUGIN_NAME_RE.test("../x")).toBe(false);
    expect(firstSentence("Short. Longer second sentence here.")).toBe("Short. Longer second sentence here.");
  });
});
