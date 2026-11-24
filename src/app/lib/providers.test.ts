import { describe, expect, it } from "vitest";
import { CLOUD_PROVIDERS, keyEnvFor, providerOf } from "./providers";

describe("cloud presets", () => {
  it("have unique ids, addresses and key variables", () => {
    for (const k of ["id", "keyEnv", "baseUrl"] as const) expect(new Set(CLOUD_PROVIDERS.map((p) => p[k])).size).toBe(CLOUD_PROVIDERS.length);
  });
  it("find OpenCode Zen and OpenCode Go by their whole address, though they share a host", () => {
    expect(providerOf("https://opencode.ai/zen/v1")?.id).toBe("opencode-zen");
    expect(keyEnvFor("https://opencode.ai/zen/v1", "x")).toBe("OPENCODE_ZEN_API_KEY");
    expect(providerOf("https://opencode.ai/zen/go/v1/")?.id).toBe("opencode-go");
    expect(keyEnvFor("https://opencode.ai/zen/go/v1", "x")).toBe("OPENCODE_GO_API_KEY");
    expect(providerOf("https://api.concentrate.ai/v1")?.keyEnv).toBe("CONCENTRATE_API_KEY");
    expect(providerOf("https://openrouter.ai/api/v1/chat")?.id).toBe("openrouter");
    expect(keyEnvFor("https://example.com/v1", "My Model")).toBe("MCBOT_MY_MODEL_API_KEY");
  });
});
