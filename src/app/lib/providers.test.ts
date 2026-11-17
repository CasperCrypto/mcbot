import { describe, expect, it } from "vitest";
import { CLOUD_PROVIDERS, keyEnvFor, providerOf } from "./providers";

describe("cloud presets", () => {
  it("have unique ids, hosts and key variables", () => {
    for (const k of ["id", "keyEnv"] as const) expect(new Set(CLOUD_PROVIDERS.map((p) => p[k])).size).toBe(CLOUD_PROVIDERS.length);
    expect(new Set(CLOUD_PROVIDERS.map((p) => new URL(p.baseUrl).host)).size).toBe(CLOUD_PROVIDERS.length);
  });
  it("find OpenCode Zen by address", () => {
    expect(providerOf("https://opencode.ai/zen/v1")?.id).toBe("opencode-zen");
    expect(keyEnvFor("https://opencode.ai/zen/v1", "x")).toBe("OPENCODE_ZEN_API_KEY");
  });
});
