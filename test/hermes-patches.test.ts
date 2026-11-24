import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { checkPatches, patchedFiles } from "../scripts/hermes-patches";

describe("McBot's patches to Hermes", () => {
  it("are all still applied in hermes/ (an edit or a sync that drops one fails here)", () => {
    expect(patchedFiles().length).toBeGreaterThan(0);
    expect(checkPatches()).toEqual([]);
  });
});

describe("the repository", () => {
  it("holds no unresolved merge conflict (an engine sync leaves them for a person)", () => {
    // git grep exits 1 when nothing matches; -I skips binary files.
    const r = spawnSync("git", ["grep", "-n", "-I", "-E", "^(<<<<<<<|>>>>>>>)( |$)"], { encoding: "utf8" });
    expect(r.stdout.trim().split("\n").filter(Boolean)).toEqual([]);
  });
});
