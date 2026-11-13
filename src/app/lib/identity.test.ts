import { describe, expect, it } from "vitest";
import { nameChosen } from "./identity";

describe("whose name it is", () => {
  it("greets people only by a name they chose", () => {
    expect(nameChosen({ name: "Ken", color: "#000" })).toBe(false);
    expect(nameChosen({ name: "Ken", color: "#000", chosen: true })).toBe(true);
    expect(nameChosen({ name: "Kacper", color: "#000" })).toBe(true);
    expect(nameChosen({ name: "Kacper", color: "#000", chosen: false })).toBe(false);
  });
});
