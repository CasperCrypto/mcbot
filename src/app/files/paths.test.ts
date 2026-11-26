import { describe, expect, it } from "vitest";
import type { FsEntry, FsRoot } from "../../contracts/api";
import { absolute, folderBrief, folderFor, freeName, readsAsPage, shownAs, splitKey, stemEnd } from "./paths";

const folder: FsRoot = { id: "folder:ab12cd34ef", kind: "folder", name: "project", path: "/Users/me/project" };
const agent: FsRoot = { id: "profile:writer", kind: "profile", name: "Writer", path: "/Users/me/McBot/hermes/profiles/writer" };
const entry = (name: string, kind: "file" | "dir" = "file", bytes = 0, children: number | null = null): FsEntry => ({ name, path: name, kind, bytes, children, owned: false });

describe("Files view paths", () => {
  it("splits a place back into its root and path, colons in the path included", () => {
    expect(splitKey("profile:writer:workspace/a:b.md")).toEqual({ rootId: "profile:writer", path: "workspace/a:b.md" });
    expect(splitKey("workspace:files:")).toEqual({ rootId: "workspace:files", path: "" });
  });

  it("drops into the folder aimed at, and into an agent's workspace when aimed at its own files", () => {
    expect(folderFor(folder, "notes", "dir")).toBe("notes");
    expect(folderFor(folder, "notes/plan.md", "file")).toBe("notes");
    expect(folderFor(folder, "", "dir")).toBe("");
    expect(folderFor(agent, "", "dir")).toBe("workspace");
    expect(folderFor(agent, "SOUL.md", "file")).toBe("workspace");
    expect(folderFor(agent, "memories", "dir")).toBe("workspace");
    expect(folderFor(agent, "workspace/out/a.png", "file")).toBe("workspace/out");
  });

  it("shows each file the way it reads best", () => {
    expect(["a.ts", "Dockerfile", "notes.md", "logo.PNG", "clip.mov", "song.mp3", "plan.excalidraw", "deck.pdf"].map(shownAs))
      .toEqual(["text", "text", "text", "image", "video", "audio", "drawing", "binary"]);
    expect([readsAsPage("README.md"), readsAsPage("a.ts")]).toEqual([true, false]);
  });

  it("names new things like Finder, and renames the name before its extension", () => {
    expect(freeName([entry("untitled.md"), entry("Untitled 2.md")], "untitled.md")).toBe("untitled 3.md");
    expect(freeName([entry("untitled folder", "dir")], "untitled folder")).toBe("untitled folder 2");
    expect(freeName([], "untitled.md")).toBe("untitled.md");
    expect([stemEnd("plan.v2.md"), stemEnd(".gitignore"), stemEnd("Makefile")]).toEqual([7, 10, 8]);
  });

  it("tells an agent where a folder is and what is in it", () => {
    expect(folderBrief("/p", [entry("src", "dir", 0, 3), entry("a.md", "file", 2048)], 5)).toBe("Folder: /p\n\n- src/ (3 items)\n- a.md (2.0 KB)\n- … and 5 more");
    expect(folderBrief("/p", [])).toBe("Folder: /p\n\n(empty)");
    expect(absolute(folder, "notes/plan.md")).toBe("/Users/me/project/notes/plan.md");
    expect(absolute({ ...folder, path: "C:\\Users\\me\\project" }, "notes/plan.md")).toBe("C:\\Users\\me\\project\\notes\\plan.md");
  });
});

describe("dropping a folder", () => {
  it("keeps a dropped folder apart from one that is there", async () => {
    const { placeDrop } = await import("./drop");
    const f = new File(["x"], "a.md");
    const items = [{ dir: "docs", file: null }, { dir: "docs/img", file: null }, { dir: "docs", file: f }, { dir: "docs/img", file: f }, { dir: "", file: f }];
    const placed = placeDrop(items, new Set(["docs"]), (w) => `${w} 2`);
    expect(placed.map((d) => d.dir)).toEqual(["docs 2", "docs 2/img", "docs 2", "docs 2/img", ""]);
    expect(placeDrop(items, new Set(), (w) => `${w} 2`).map((d) => d.dir)).toEqual(["docs", "docs/img", "docs", "docs/img", ""]);
  });
});
