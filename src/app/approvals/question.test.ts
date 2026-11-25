import { describe, expect, it } from "vitest";
import { encodeAnswer, questionChoices, secondsLeft } from "./question";

describe("what an agent asks", () => {
  it("shows Hermes' suggestion without its mark, and sends the choice back as Hermes gave it", () => {
    expect(questionChoices(["Red (Recommended)", "Blue"])).toEqual([
      { label: "Red", value: "Red (Recommended)", recommended: true },
      { label: "Blue", value: "Blue", recommended: false },
    ]);
  });

  it("answers with a choice, several as a JSON array, typed text, or nothing to skip", () => {
    expect(encodeAnswer({ picked: ["Red (Recommended)"], multi: false })).toBe("Red (Recommended)");
    expect(encodeAnswer({ picked: ["Red", "Blue"], multi: true })).toBe('["Red","Blue"]');
    expect(encodeAnswer({ text: "  green, please " })).toBe("green, please");
    expect(encodeAnswer("skip")).toBe("");
  });

  it("counts down to Hermes' limit", () => {
    expect(secondsLeft(1_000, 90, 31_000)).toBe(60);
    expect(secondsLeft(1_000, 90, 200_000)).toBe(0);
    expect(secondsLeft(1_000, null, 31_000)).toBeNull();
    expect(secondsLeft(1_000, 0, 31_000)).toBeNull();
  });
});
