/**
 * Every test run gets its own temp folder (TMPDIR, so `os.tmpdir()` in the
 * workers points into it) and removes it at the end. Real-Hermes runs leave a
 * full Hermes home behind (hundreds of MB), so they must not pile up in /tmp.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export default function setup(): () => void {
  const dir = mkdtempSync(join(tmpdir(), "mcbot-test-run-"));
  process.env.TMPDIR = dir;
  process.env.TEMP = dir;
  process.env.TMP = dir;
  return () => {
    rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
  };
}
