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
