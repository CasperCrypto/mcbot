import { describe, expect, it } from "vitest";
import { AgentDataSchema } from "../contracts/graph";
import { renderProfileMeta } from "./profileMeta";

describe("renderProfileMeta", () => {
  it("writes description and display_name as read by read_profile_meta", () => {
    const a = AgentDataSchema.parse({ name: "triage", displayName: " Triage ", description: "Routes: tickets." });
    expect(renderProfileMeta(a)).toBe('description: "Routes: tickets."\ndisplay_name: Triage\n');
  });
  it("returns null when there is no metadata to write", () => {
    expect(renderProfileMeta(AgentDataSchema.parse({ name: "triage" }))).toBeNull();
  });
});
