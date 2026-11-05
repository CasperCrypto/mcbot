import { describe, expect, it } from "vitest";
import { checkPatches, patchedFiles } from "../scripts/hermes-patches";

describe("McBot's patches to Hermes", () => {
  it("are all still applied in hermes/ (an edit or a sync that drops one fails here)", () => {
    expect(patchedFiles().length).toBeGreaterThan(0);
    expect(checkPatches()).toEqual([]);
  });
});
