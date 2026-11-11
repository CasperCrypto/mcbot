import { describe, expect, it } from "vitest";
import { ISSUES_URL, issueUrl } from "./report";

describe("issueUrl", () => {
  it("fills in the summary and leaves the engine log out of the link", () => {
    const details = "McBot 0.1.0 · installed app\nSystem: macOS (darwin 24.1.0, arm64)\nEngine: built in, prepared\n\nEngine log, last lines:\nsomething private happened";
    const url = new URL(issueUrl(details));
    expect(`${url.origin}${url.pathname}`).toBe(ISSUES_URL);
    const body = url.searchParams.get("body")!;
    expect(body).toContain("McBot 0.1.0 · installed app\nSystem: macOS (darwin 24.1.0, arm64)\nEngine: built in, prepared");
    expect(body).not.toContain("something private happened");
    expect(body).not.toContain("Engine log");
  });
});
