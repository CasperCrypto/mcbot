import { describe, expect, it } from "vitest";
import { drawingFileName, isDrawingFile, parseDrawing } from "./drawing";
import { parseRich } from "./rich";

describe("drawings", () => {
  it("reads the skeleton form models write", () => {
    const s = parseDrawing('[{"type":"rectangle","id":"a","x":0,"y":0,"label":{"text":"Planner"}},{"type":"arrow","x":0,"y":0,"start":{"id":"a"},"end":{"id":"b"}}]');
    expect(s?.elements).toHaveLength(2);
    expect(s?.skeleton).toBe(true);
  });

  it("reads Excalidraw's own file and drops deleted and unknown elements", () => {
    const file = { type: "excalidraw", version: 2, elements: [
      { type: "ellipse", id: "e", x: 1, y: 2, seed: 7, version: 3 },
      { type: "rectangle", id: "gone", seed: 1, version: 1, isDeleted: true },
      { type: "script", id: "x" },
    ], files: { f1: { mimeType: "image/png" } } };
    const s = parseDrawing(JSON.stringify(file));
    expect(s?.elements.map((e) => e.id)).toEqual(["e"]);
    expect(s?.skeleton).toBe(false);
    expect(Object.keys(s?.files ?? {})).toEqual(["f1"]);
  });

  it("refuses what is not a drawing", () => {
    expect(parseDrawing("not json")).toBeNull();
    expect(parseDrawing('{"elements":[]}')).toBeNull();
    expect(parseDrawing('{"hello":1}')).toBeNull();
  });

  it("is a block in an answer; a broken one stays code", () => {
    const ok = parseRich('Look:\n```excalidraw\n[{"type":"text","x":0,"y":0,"text":"Hi"}]\n```');
    expect(ok.map((b) => b.t)).toEqual(["p", "drawing"]);
    const bad = parseRich("```excalidraw\n{oops\n```");
    expect(bad[0]).toMatchObject({ t: "code", lang: "excalidraw" });
  });

  it("names files from the first words", () => {
    const s = parseDrawing('[{"type":"rectangle","x":0,"y":0,"label":{"text":"Research Flow!"}}]')!;
    expect(drawingFileName(s)).toBe("drawings/research-flow.excalidraw");
    expect(drawingFileName(parseDrawing('[{"type":"line","x":0,"y":0}]')!, new Date("2026-11-19T00:00:00Z"))).toBe("drawings/drawing-2026-11-19.excalidraw");
    expect(isDrawingFile("a/b.excalidraw")).toBe(true);
    expect(isDrawingFile("a/b.json")).toBe(false);
  });
});
