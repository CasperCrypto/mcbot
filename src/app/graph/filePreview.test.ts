import { createTwoFilesPatch } from "diff";
import { describe, expect, it } from "vitest";
import type { FileChange } from "../../contracts/compile";
import { afterText, diskPath, fileLines } from "./filePreview";

const change = (status: FileChange["status"], before: string, after: string): FileChange => ({
  path: "profiles/triage/config.yaml", status, sha256: null, previousSha256: null, bytes: after.length, role: "config", nodeId: "a1",
  // the writer's own format (engine/writer.ts unifiedDiff)
  diff: status === "unchanged" ? "" : createTwoFilesPatch("a/x", "b/x", before, after, "", "", { context: 3 }),
});

describe("live files", () => {
  it("finds a compiled file on disk", () => {
    expect(diskPath("profiles/triage/config.yaml")).toEqual({ root: "profile:triage", rel: "config.yaml" });
    expect(diskPath("profiles/triage/skills/x/SKILL.md")).toEqual({ root: "profile:triage", rel: "skills/x/SKILL.md" });
    expect(diskPath(".mcbot/manifest.json")).toBeNull();
  });

  it("rebuilds the whole file Compile would write, from disk and the dry run's diff", () => {
    const before = "model:\n  default: gemma3:4b\n  provider: custom:mcbot-ollama\nmemory:\n  memory_enabled: true\n";
    const after = "model:\n  default: qwen3:8b\n  provider: custom:mcbot-ollama\nmemory:\n  memory_enabled: true\n";
    expect(afterText(before, change("modified", before, after))).toBe(after);
    expect(afterText("", change("added", "", after))).toBe(after);
    expect(afterText(before, change("unchanged", before, before))).toBe(before);
    expect(afterText(before, change("removed", before, ""))).toBe("");
  });

  it("marks each line added, removed or the same", () => {
    const lines = fileLines("a\nb\nc\n", "a\nB\nc\n");
    expect(lines).toEqual([
      { kind: "same", text: "a" },
      { kind: "del", text: "b" },
      { kind: "add", text: "B" },
      { kind: "same", text: "c" },
    ]);
  });
});
