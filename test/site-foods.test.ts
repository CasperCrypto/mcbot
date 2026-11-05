import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { siteFoods } from "../scripts/site-foods";

describe("the website's food bots", () => {
  it("and the logo files match the app's (run `npm run site:foods` after changing faces/foods.ts or faces.css)", () => {
    const { js, css, logo, icon } = siteFoods();
    const root = join(import.meta.dirname, "..");
    expect(readFileSync(join(root, "site/foods.js"), "utf8")).toBe(js);
    expect(readFileSync(join(root, "site/foods.css"), "utf8")).toBe(css);
    expect(readFileSync(join(root, "site/assets/logo.svg"), "utf8")).toBe(logo);
    expect(readFileSync(join(root, "design/icon.svg"), "utf8")).toBe(icon);
  });
});
