import { describe, expect, it } from "vitest";
import { plainLine } from "./format";

describe("plainLine", () => {
  it("shows an answer's first line without Markdown marks", () => {
    expect(plainLine("Your order **#1042** left our warehouse")).toBe("Your order #1042 left our warehouse");
    expect(plainLine("## Summary\nMore")).toBe("Summary");
    expect(plainLine("- see [the docs](https://x.io) and `npm test`")).toBe("see the docs and npm test");
    expect(plainLine("```js\nconst a = 1\n```\nDone, *quickly*.")).toBe("Done, quickly.");
    expect(plainLine("snake_case_name stays")).toBe("snake_case_name stays");
  });
});
