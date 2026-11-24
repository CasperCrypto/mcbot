import { describe, expect, it } from "vitest";
import type { SetupProfile } from "../../contracts/api";
import { boardName, userFacts } from "./presets";

const company: SetupProfile = { kind: "company", name: "Maya", company: "Acme", about: "Invoicing software for small shops.", role: "Head of support" };
const personal: SetupProfile = { kind: "personal", name: "Kai", company: "", about: "plan my week, answer email", role: "" };

describe("setup presets", () => {
  it("writes who the user is into memory facts and names the board", () => {
    expect(userFacts(company)).toBe("The user is Maya, Head of support at Acme. Acme: Invoicing software for small shops.");
    expect(userFacts(personal)).toBe("The user is Kai. Wants help with: plan my week, answer email.");
    expect(boardName(company)).toBe("Acme");
    expect(boardName(personal)).toBe("Kai's agents");
  });
});
