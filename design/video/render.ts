/**
 * Renders the launch video (design/video/index.html) frame by frame: headless Chromium draws each frame
 * from its time alone (scenes.js `VIDEO.render(t)`), and ffmpeg encodes the frames as H.264. Workers
 * render parts of the timeline side by side; the parts are joined without re-encoding.
 *
 *   npx tsx design/video/render.ts                      the video, 1920×1080 at 60 fps → design/video/out/
 *   npx tsx design/video/render.ts --still 12.5,30      frames as PNGs (to look at a moment)
 *   npx tsx design/video/render.ts --fps 30 --scale 0.5 a quick, small preview
 *   npx tsx design/video/render.ts --gif 4 11.4         a GIF of seconds 4 to 11.4 (for X and Reddit)
 *
 * Needs Playwright with Chromium (`npx playwright install chromium` on a new machine) and ffmpeg.
 * The bots come from site/foods.js and the brand marks from the app's logo table, so they match the app.
 */
import { spawn } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { cpus } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import qrcode from "qrcode-generator";
import { LOGOS } from "../../src/app/lib/logos.generated";

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
/** The little of Playwright this uses (it is not a dependency of the repo: install it where you render). */
type Page = {
  addInitScript(script: string): Promise<void>;
  goto(url: string, o?: { waitUntil?: "load" }): Promise<unknown>;
  evaluate<R, A = undefined>(fn: (arg: A) => R | Promise<R>, arg?: A): Promise<Awaited<R>>;
  screenshot(o: Record<string, unknown>): Promise<Buffer>;
};
type Browser = { newContext(o: Record<string, unknown>): Promise<{ newPage(): Promise<Page> }>; close(): Promise<void> };
const { chromium } = require("playwright") as { chromium: { launch(): Promise<Browser> } };

const W = 1920;
const H = 1080;
const USED = ["claude", "ollama", "gemini", "deepseek", "slack", "notion", "github", "gmail", "exa"];

const args = process.argv.slice(2);
const opt = (name: string, fallback: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1]! : fallback;
};
const fps = Number(opt("fps", "60"));
const scale = Number(opt("scale", "1"));
const out = opt("out", join(here, "out"));
const workers = Number(opt("workers", String(Math.max(1, Math.min(4, cpus().length - 1)))));
const stills = args.includes("--still") ? opt("still", "0").split(",").map(Number) : null;
const gifAt = args.indexOf("--gif");

/** The QR code for mcbot.studio, as an SVG the Share scene shows. */
function qrSvg(): string {
  const qr = qrcode(0, "M");
  qr.addData("https://mcbot.studio");
  qr.make();
  const n = qr.getModuleCount();
  let d = "";
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) d += `M${c} ${r}h1v1h-1z`;
  return `<svg viewBox="0 0 ${n} ${n}" shape-rendering="crispEdges"><path fill="#000" d="${d}"/></svg>`;
}

async function page() {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: scale });
  const p = await context.newPage();
  const logos = Object.fromEntries(USED.map((k) => [k, LOGOS[k]]).filter(([, v]) => v));
  await p.addInitScript(`window.__RENDERING__ = true; window.LOGOS = ${JSON.stringify(logos)}; window.QR_SVG = ${JSON.stringify(qrSvg())};`);
  await p.goto(pathToFileURL(join(here, "index.html")).href, { waitUntil: "load" });
  await p.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all([...document.images].map((i) => i.decode().catch(() => undefined)));
    (window as unknown as { VIDEO: { setup(): void } }).VIDEO.setup();
  });
  return { browser, p };
}

const frameAt = (p: Page, t: number) =>
  p.evaluate((tt) => (window as unknown as { VIDEO: { render(t: number): void } }).VIDEO.render(tt), t).then(() =>
    p.screenshot({ type: "png", clip: { x: 0, y: 0, width: W, height: H }, animations: "allow", caret: "initial" }));

function ffmpeg(argv: string[]) {
  const ff = spawn("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...argv], { stdio: ["pipe", "inherit", "inherit"] });
  const done = new Promise<void>((res, rej) => ff.on("close", (code) => (code === 0 ? res() : rej(new Error(`ffmpeg exited ${code}`)))));
  return { ff, done };
}

/** Frames [from, to) into one H.264 file. */
async function segment(from: number, to: number, file: string, onFrame: () => void) {
  const { browser, p } = await page();
  const size = `${Math.round(W * Math.min(1, scale))}:${Math.round(H * Math.min(1, scale))}`;
  const { ff, done } = ffmpeg([
    "-f", "image2pipe", "-framerate", String(fps), "-i", "-",
    "-vf", `scale=${size}:flags=lanczos:out_color_matrix=bt709:out_range=tv,format=yuv420p`,
    "-c:v", "libx264", "-preset", "slow", "-crf", "14", "-tune", "animation", "-profile:v", "high",
    "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709", "-color_range", "tv",
    "-g", String(fps * 2), file,
  ]);
  for (let f = from; f < to; f++) {
    const png = await frameAt(p, f / fps);
    if (!ff.stdin.write(png)) await new Promise((r) => ff.stdin.once("drain", r));
    onFrame();
  }
  ff.stdin.end();
  await done;
  await browser.close();
}

async function main() {
  mkdirSync(out, { recursive: true });
  if (stills) {
    const { browser, p } = await page();
    for (const t of stills) {
      const file = join(out, `still-${t.toFixed(2)}.png`);
      writeFileSync(file, await frameAt(p, t));
      console.log(file);
    }
    await browser.close();
    return;
  }
  const { browser, p } = await page();
  const duration = await p.evaluate(() => (window as unknown as { VIDEO: { duration: number } }).VIDEO.duration);
  await browser.close();

  const from = gifAt >= 0 ? Number(args[gifAt + 1] ?? 0) : 0;
  const to = gifAt >= 0 ? Number(args[gifAt + 2] ?? duration) : duration;
  const total = Math.round((to - from) * fps);
  const first = Math.round(from * fps);
  const parts = Math.max(1, Math.min(workers, Math.ceil(total / (fps * 2))));
  const tmp = join(out, "parts");
  rmSync(tmp, { recursive: true, force: true });
  mkdirSync(tmp, { recursive: true });
  let doneFrames = 0;
  const t0 = Date.now();
  const tick = () => {
    doneFrames++;
    if (doneFrames % fps === 0 || doneFrames === total) {
      const s = (Date.now() - t0) / 1000;
      process.stdout.write(`\r${doneFrames}/${total} frames · ${s.toFixed(0)} s · ${(doneFrames / s).toFixed(1)} fps   `);
    }
  };
  const files = Array.from({ length: parts }, (_, i) => join(tmp, `part-${i}.mp4`));
  await Promise.all(files.map((file, i) => {
    const a = first + Math.floor((total * i) / parts);
    const b = first + Math.floor((total * (i + 1)) / parts);
    return segment(a, b, file, tick);
  }));
  process.stdout.write("\n");
  writeFileSync(join(tmp, "list.txt"), files.map((f) => `file '${f}'`).join("\n"));
  const name = gifAt >= 0 ? "clip" : `mcbot-studio-launch-${Math.round(H * Math.min(1, scale))}p${fps}`;
  const mp4 = join(out, `${name}.mp4`);
  await ffmpeg(["-f", "concat", "-safe", "0", "-i", join(tmp, "list.txt"), "-c", "copy", "-movflags", "+faststart", mp4]).done;
  if (gifAt >= 0) {
    const gif = join(out, `mcbot-studio-${from}-${to}.gif`);
    await ffmpeg(["-i", mp4, "-vf", "fps=24,scale=960:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=128:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle", gif]).done;
    console.log(gif);
  } else console.log(mp4);
  rmSync(tmp, { recursive: true, force: true });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
