import { describe, expect, it } from "vitest";
import type { CompiledFile } from "../contracts/compile";
import { buildManifest, renderManifest } from "./manifest";

const f = (path: string, sha256: string, bytes: number): CompiledFile => ({ path, sha256, bytes, content: "", role: "soul" });

describe("manifest", () => {
  it("lists files sorted by path with hash and size, as exact JSON bytes", () => {
    const m = buildManifest("g1", ["zed", "alpha"], [f("profiles/zed/SOUL.md", "bb", 2), f("profiles/alpha/SOUL.md", "aa", 1)]);
    expect(renderManifest(m)).toBe(
      [
        "{",
        '  "schema": "mcbot.compile/v1",',
        '  "graphId": "g1",',
        '  "profiles": [',
        '    "alpha",',
        '    "zed"',
        "  ],",
        '  "files": [',
        "    {",
        '      "path": "profiles/alpha/SOUL.md",',
        '      "sha256": "aa",',
        '      "bytes": 1',
        "    },",
        "    {",
        '      "path": "profiles/zed/SOUL.md",',
        '      "sha256": "bb",',
        '      "bytes": 2',
        "    }",
        "  ]",
        "}",
        "",
      ].join("\n"),
    );
  });
});
