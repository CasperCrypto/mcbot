import { describe, expect, it } from "vitest";
import { inline, parseChart, parseRich, withRichAnswers } from "./rich";

describe("rich answers", () => {
  it("reads the Markdown agents write", () => {
    const blocks = parseRich("# Plan\n\nShip **today**, see [docs](https://x.io).\n\n- one\n- two\n\n1. a\n2. b\n\n> note\n\n---\n\n```ts\nconst a = 1;\n```");
    expect(blocks.map((b) => b.t)).toEqual(["h", "p", "ul", "ol", "quote", "hr", "code"]);
    expect(blocks[1]).toEqual({ t: "p", v: [{ t: "text", v: "Ship " }, { t: "b", v: [{ t: "text", v: "today" }] }, { t: "text", v: ", see " }, { t: "link", v: "docs", href: "https://x.io" }, { t: "text", v: "." }] });
    expect(blocks[6]).toEqual({ t: "code", lang: "ts", v: "const a = 1;" });
  });

  it("reads tables", () => {
    const [t] = parseRich("| Month | Sales |\n|---|---:|\n| Oct | 12 |\n| Nov | 15 |");
    expect(t).toEqual({ t: "table", head: [[{ t: "text", v: "Month" }], [{ t: "text", v: "Sales" }]], rows: [[[{ t: "text", v: "Oct" }], [{ t: "text", v: "12" }]], [[{ t: "text", v: "Nov" }], [{ t: "text", v: "15" }]]] });
  });

  it("draws chart blocks and keeps a broken one as code", () => {
    const [c] = parseRich('```chart\n{"type":"bar","title":"Posts","labels":["Mon","Tue"],"series":[{"name":"Likes","data":[3,"x"]}]}\n```');
    expect(c).toEqual({ t: "chart", chart: { type: "bar", title: "Posts", labels: ["Mon", "Tue"], series: [{ name: "Likes", data: [3, 0] }] } });
    expect(parseRich("```chart\nnot json\n```")[0]!.t).toBe("code");
    expect(parseChart('{"type":"radar","labels":[],"series":[]}')).toBeNull();
  });

  it("turns a choices block into replies", () => {
    expect(parseRich("Which one?\n```choices\n- Post it now\n- Make another image\n```")[1]).toEqual({ t: "choices", items: ["Post it now", "Make another image"] });
  });

  it("finds images and inline code, never HTML", () => {
    expect(inline("![chart](out/sales.png) and `x`")).toEqual([{ t: "img", alt: "chart", src: "out/sales.png" }, { t: "text", v: " and " }, { t: "code", v: "x" }]);
    expect(parseRich("<script>alert(1)</script>")).toEqual([{ t: "p", v: [{ t: "text", v: "<script>alert(1)</script>" }] }]);
  });

  it("teaches a soul once", () => {
    const once = withRichAnswers("You write posts.");
    expect(once).toContain("```chart");
    expect(withRichAnswers(once)).toBe(once);
  });
});
