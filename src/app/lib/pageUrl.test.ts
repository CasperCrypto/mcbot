import { describe, expect, it } from "vitest";
import { framedUrl, toUrl } from "../lib/pageUrl";

describe("the browser's addresses", () => {
  it("makes web addresses from what people type, a search otherwise", () => {
    expect(toUrl("localhost:3000")).toBe("http://localhost:3000");
    expect(toUrl("github.com/CasperCrypto")).toBe("https://github.com/CasperCrypto");
    expect(toUrl("javascript:alert(1)")).toMatch(/^https:\/\/duckduckgo\.com\/\?q=/);
    expect(toUrl("data:text/html,<b>x</b>")).toMatch(/^https:\/\/duckduckgo\.com\/\?q=/);
  });

  it("loads only web pages in the frame", () => {
    expect(framedUrl("https://en.wikipedia.org/wiki/Mac?x=1#top")).toBe("https://en.wikipedia.org/wiki/Mac?x=1#top");
    expect(framedUrl("http://localhost:5173/")).toBe("http://localhost:5173/");
    expect(framedUrl("https://user:pw@example.com/a")).toBe("https://example.com/a");
    expect(framedUrl("https://example.com/a'b?q=\"<x>\"")).toBe("https://example.com/a%27b?q=%22%3Cx%3E%22");
    expect(framedUrl("https://duckduckgo.com/?q=a%20b%2Fc")).toBe("https://duckduckgo.com/?q=a%20b%2Fc");
    for (const bad of ["javascript:alert(1)", "JavaScript:alert(1)", "data:text/html,<b>x</b>", "file:///etc/passwd", "about:srcdoc", "not a url"]) expect(framedUrl(bad)).toBe("about:blank");
  });
});
