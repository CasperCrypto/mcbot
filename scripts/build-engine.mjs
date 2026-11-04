/**
 * Build the McBot engine as one program the desktop app starts (a Tauri "sidecar"):
 *   1. bundle engine/main.ts into one CommonJS file (esbuild),
 *   2. embed it in a copy of this Node binary (Node single executable application),
 *   3. write src-tauri/binaries/mcbot-engine-<target triple>[.exe], the name Tauri's externalBin expects.
 *
 *   node scripts/build-engine.mjs [--target <rust target triple>]
 *
 * The target is --target, else the one `tauri build` is building (TAURI_ENV_TARGET_TRIPLE), else
 * this machine. For another CPU of the same OS (an Intel Mac built on Apple silicon) it downloads
 * that platform's Node of the same version. Unsigned: on macOS the binary gets an ad-hoc signature,
 * which Apple silicon requires to run at all.
 */
import { execFileSync } from "node:child_process";
import { copyFileSync, chmodSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "dist-engine");
mkdirSync(out, { recursive: true });

const arg = process.argv.indexOf("--target");
const target = (arg > 0 ? process.argv[arg + 1] : process.env.TAURI_ENV_TARGET_TRIPLE)
  || execFileSync("rustc", ["-vV"], { encoding: "utf8" }).match(/^host: (.+)$/m)?.[1];
if (!target) throw new Error("no target triple: pass --target or install rustc");
const win = target.includes("windows");
const mac = target.includes("apple");

// 1. One CommonJS file (Node's single executable applications run CommonJS).
await build({
  entryPoints: [join(root, "engine", "main.ts")],
  outfile: join(out, "engine.cjs"),
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node22",
  // ws loads these native speed-ups when present; it works without them.
  external: ["bufferutil", "utf-8-validate"],
  logLevel: "warning",
  logOverride: { "empty-import-meta": "silent" }, // hermes.ts falls back when import.meta is absent
});

// 2. The blob Node injects into its own binary.
const seaConfig = join(out, "sea-config.json");
writeFileSync(seaConfig, JSON.stringify({ main: join(out, "engine.cjs"), output: join(out, "engine.blob"), disableExperimentalSEAWarning: true, useCodeCache: false }));
execFileSync(process.execPath, ["--experimental-sea-config", seaConfig], { stdio: "inherit" });

/** This Node, or the same version built for the target's CPU (nodejs.org). */
async function nodeFor(triple) {
  const arch = triple.startsWith("aarch64") ? "arm64" : triple.startsWith("x86_64") ? "x64" : null;
  const os = triple.includes("apple") ? "darwin" : triple.includes("windows") ? "win" : "linux";
  const hostOs = process.platform === "win32" ? "win" : process.platform;
  if (!arch || (arch === process.arch && os === hostOs)) return process.execPath;
  if (os !== hostOs) throw new Error(`build the ${triple} engine on ${os}`);
  const name = `node-${process.version}-${os}-${arch}`;
  const dir = join(out, name);
  const bin = join(dir, os === "win" ? "node.exe" : "bin/node");
  if (!existsSync(bin)) {
    const file = join(out, `${name}.tar.gz`);
    const res = await fetch(`https://nodejs.org/dist/${process.version}/${name}.tar.gz`);
    if (!res.ok) throw new Error(`download ${name}: HTTP ${res.status}`);
    writeFileSync(file, Buffer.from(await res.arrayBuffer()));
    execFileSync("tar", ["-xzf", file, "-C", out]);
  }
  return bin;
}

// 3. A copy of node with the blob in it, named for Tauri.
const binDir = join(root, "src-tauri", "binaries");
mkdirSync(binDir, { recursive: true });
const exe = join(binDir, `mcbot-engine-${target}${win ? ".exe" : ""}`);
copyFileSync(await nodeFor(target), exe);
chmodSync(exe, 0o755);
if (mac) execFileSync("codesign", ["--remove-signature", exe]);
const postject = join(root, "node_modules", "postject", "dist", "cli.js");
execFileSync(process.execPath, [
  postject, exe, "NODE_SEA_BLOB", join(out, "engine.blob"),
  "--sentinel-fuse", "NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2",
  ...(mac ? ["--macho-segment-name", "NODE_SEA"] : []),
], { stdio: "inherit" });
if (mac) execFileSync("codesign", ["--sign", "-", exe]);
console.log(`engine: ${exe}`);
