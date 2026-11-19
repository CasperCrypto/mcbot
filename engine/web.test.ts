import { describe, expect, it } from "vitest";
import { frameableFromHeaders } from "./web";

describe("can a page show in a frame", () => {
  it("reads X-Frame-Options and frame-ancestors", () => {
    expect(frameableFromHeaders(new Headers())).toBe(true);
    expect(frameableFromHeaders(new Headers({ "x-frame-options": "SAMEORIGIN" }))).toBe(false);
    expect(frameableFromHeaders(new Headers({ "x-frame-options": "DENY" }))).toBe(false);
    expect(frameableFromHeaders(new Headers({ "content-security-policy": "default-src 'self'; frame-ancestors 'self'" }))).toBe(false);
    expect(frameableFromHeaders(new Headers({ "content-security-policy": "frame-ancestors *" }))).toBe(true);
    expect(frameableFromHeaders(new Headers({ "content-security-policy": "default-src 'self'" }))).toBe(true);
  });
});

describe("frameable: does the page answer", () => {
  it("says a refused port or an unknown name is unreachable, and only http(s) is asked", async () => {
    const { frameable } = await import("./web");
    expect((await frameable("http://127.0.0.1:9/", 3000)).reachable).toBe(false);
    expect((await frameable("http://no-such-host.invalid/", 3000)).reachable).toBe(false);
    expect((await frameable("file:///etc/passwd")).reachable).toBe(false);
  });
});
