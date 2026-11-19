import { describe, expect, it } from "vitest";
import { newer, updateChecker, updateFromRelease } from "./updates";

describe("update check", () => {
  it("compares versions as numbers", () => {
    expect(newer("0.10.0", "0.9.9")).toBe(true);
    expect(newer("v0.5.0", "0.4.4")).toBe(true);
    expect(newer("0.4.4", "0.4.4")).toBe(false);
    expect(newer("0.4.3", "0.4.4")).toBe(false);
    expect(newer("nightly", "0.4.4")).toBe(false);
  });
  it("reads GitHub's latest release, ignoring drafts and odd links", () => {
    const rel = { tag_name: "v0.5.0", html_url: "https://github.com/CasperCrypto/mcbot/releases/tag/v0.5.0" };
    expect(updateFromRelease(rel, "0.4.4")).toEqual({ current: "0.4.4", latest: "0.5.0", url: rel.html_url, available: true });
    expect(updateFromRelease({ ...rel, draft: true }, "0.4.4").available).toBe(false);
    expect(updateFromRelease({ ...rel, html_url: "https://evil.example/x" }, "0.4.4").available).toBe(false);
    expect(updateFromRelease(null, "0.4.4").available).toBe(false);
  });
  it("asks once and keeps the answer; offline says nothing", async () => {
    let calls = 0;
    const ok = (async () => { calls++; return new Response(JSON.stringify({ tag_name: "v9.0.0", html_url: "https://github.com/CasperCrypto/mcbot/releases/tag/v9.0.0" })); }) as typeof fetch;
    const c = updateChecker("0.4.4", ok);
    expect((await c.get()).available).toBe(true);
    await c.get();
    expect(calls).toBe(1);
    const down = updateChecker("0.4.4", (async () => { throw new Error("offline"); }) as typeof fetch);
    expect(await down.get()).toEqual({ current: "0.4.4", latest: null, url: null, available: false });
  });
});
