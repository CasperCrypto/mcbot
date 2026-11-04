import { describe, expect, it } from "vitest";
import { toYaml, yamlComment } from "./yaml";

describe("toYaml", () => {
  it("quotes every scalar YAML 1.1 would read as a non-string, and nothing else", () => {
    const out = toYaml({ args: ["yes", "off", "y", "0755", "1:30", "12", "-y", "@scope/pkg", "${workspaceFolder}", "custom:mcbot-x"] });
    expect(out).toBe(
      [
        "args:",
        '  - "yes"',
        '  - "off"',
        '  - "y"',
        '  - "0755"',
        '  - "1:30"',
        '  - "12"',
        "  - -y",
        '  - "@scope/pkg"',
        "  - ${workspaceFolder}",
        "  - custom:mcbot-x",
        "",
      ].join("\n"),
    );
  });

  it("keeps insertion order and never folds long lines", () => {
    const long = "x".repeat(200);
    expect(toYaml({ b: 1, a: long })).toBe(`b: 1\na: ${long}\n`);
  });
});

describe("yamlComment", () => {
  it("prefixes each line", () => {
    expect(yamlComment(["one", "", "two"])).toBe("# one\n#\n# two\n");
  });
});
