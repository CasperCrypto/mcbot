import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ACCENTS } from "../lib/appearance";

const dir = join(__dirname);
const tokens = readFileSync(join(dir, "tokens.css"), "utf8");
const block = (selector: string) => {
  const i = tokens.indexOf(`${selector} {`);
  return i < 0 ? "" : tokens.slice(i, tokens.indexOf("}", i));
};
const names = (css: string) => new Set([...css.matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1]!));

describe("design tokens", () => {
  it("give every accent its colour and channels", () => {
    for (const a of ACCENTS.filter((x) => x !== "blue")) {
      expect(block(`:root[data-accent="${a}"]`), a).toContain("--accent-rgb");
      expect(block(`:root[data-accent="${a}"]`), a).toContain("--accent-text");
    }
  });

  it("keep literal colours out of the other style sheets", () => {
    // Overlays and text colours go through tokens (rgb(var(--tint-rgb) / a), var(--text)…), so a
    // change of palette is one edit in tokens.css. Fixed-colour surfaces are the exceptions: the
    // island and the floating pill (always black), colour tiles, colour swatches, sticky-note paper,
    // Windows' window buttons, and the accent-filled menu row.
    const allowed = /island|pill-|\.pill\b|^\s*\.tile\s*\{|\.swatch|sticky|win-controls|\.menu button|\.peer-tag|\.cursor \.tag|\.badge|\.unread|doctor-count|\.switch span|start-mark|browser-page iframe|setup-checks|--fill-\d|\.ap-|accent-swatch/;
    const bad: string[] = [];
    for (const f of readdirSync(dir).filter((x) => x.endsWith(".css") && x !== "tokens.css")) {
      let rule = ""; // the selector of a rule that spans lines
      readFileSync(join(dir, f), "utf8").split("\n").forEach((line, i) => {
        if (line.includes("{") && !line.includes("}")) rule = line;
        else if (line.trim() === "}" || (line.includes("}") && !line.includes("{"))) rule = "";
        if (allowed.test(line) || (rule && allowed.test(rule))) return;
        if (/rgba\(\s*(255\s*,\s*255\s*,\s*255|0\s*,\s*0\s*,\s*0|10\s*,\s*132\s*,\s*255)\s*,/.test(line) || /(?<![-\w])(color|background):\s*#[0-9a-f]{3,8}\b/i.test(line)) bad.push(`${f}:${i + 1}: ${line.trim().slice(0, 90)}`);
      });
    }
    expect(bad).toEqual([]);
  });
});
