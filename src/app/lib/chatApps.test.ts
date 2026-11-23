import { describe, expect, it } from "vitest";
import { PLATFORMS } from "../../contracts/platforms.generated";
import { chatAppNeeds } from "./chatApps";

describe("chatAppNeeds", () => {
  it("says how many keys and settings, and where they come from", () => {
    expect(chatAppNeeds([{ env: "A", secret: true, prompt: "Bot token", url: "https://api.slack.com/apps" }, { env: "B", secret: true, prompt: "App token" }])).toBe("2 keys · api.slack.com");
    expect(chatAppNeeds([{ env: "U", secret: false, prompt: "Server URL" }, { env: "P", secret: true, prompt: "Password" }])).toBe("A key and a setting");
    expect(chatAppNeeds([{ env: "U", secret: false, prompt: "Server URL" }])).toBe("A setting");
    expect(chatAppNeeds([])).toBe("Nothing to set up");
  });

  it("reads every chat app Hermes ships", () => {
    for (const p of Object.values(PLATFORMS)) expect(chatAppNeeds(p.required).length).toBeGreaterThan(3);
  });
});
