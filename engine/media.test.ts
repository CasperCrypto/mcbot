import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { mediaFile } from "./media";

describe("mediaFile", () => {
  const root = mkdtempSync(join(tmpdir(), "mcbot-media-"));
  const profile = join(root, "profiles", "artist");
  mkdirSync(join(profile, "cache/generated/images"), { recursive: true });
  writeFileSync(join(profile, "cache/generated/images/a.png"), "png");
  writeFileSync(join(profile, ".env"), "K=v\n");
  writeFileSync(join(root, "outside.png"), "png");

  it("serves an image inside the agent's folder", async () => {
    await expect(mediaFile(profile, join(profile, "cache/generated/images/a.png"))).resolves.toMatchObject({ type: "image/png", size: 3 });
  });
  it("refuses files outside it, through .. or a symlink, and anything that is not media", async () => {
    await expect(mediaFile(profile, join(profile, "../../outside.png"))).rejects.toMatchObject({ status: 403 });
    if (process.platform !== "win32") {
      symlinkSync(join(root, "outside.png"), join(profile, "link.png"));
      await expect(mediaFile(profile, join(profile, "link.png"))).rejects.toMatchObject({ status: 403 });
    }
    await expect(mediaFile(profile, join(profile, ".env"))).rejects.toMatchObject({ status: 415 });
    await expect(mediaFile(profile, join(profile, "missing.png"))).rejects.toMatchObject({ status: 404 });
  });
});
