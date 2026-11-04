/**
 * Regenerate test/fixtures/<name>.expected/ from <name>.graph.json.
 * Only run after reviewing the diff `npm test` printed: golden files are the
 * byte-level contract the compiler is held to.
 */
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { compile } from "../src/compile/index";

const dir = join(import.meta.dirname, "..", "test", "fixtures");
for (const name of readdirSync(dir).filter((f) => f.endsWith(".graph.json"))) {
  const out = join(dir, name.replace(".graph.json", ".expected"));
  rmSync(out, { recursive: true, force: true });
  const result = compile(JSON.parse(readFileSync(join(dir, name), "utf8")));
  for (const f of result.files) {
    mkdirSync(dirname(join(out, f.path)), { recursive: true });
    writeFileSync(join(out, f.path), f.content);
  }
  console.log(`${name}: ${result.files.length} files -> ${out}`);
}
