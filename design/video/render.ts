/**
 * Renders the launch video (design/video/index.html) frame by frame, with its soundtrack: headless Chromium
 * draws each frame from its time alone (scenes.js `VIDEO.render(t)`), ffmpeg encodes the frames as H.264
 * (workers render parts of the timeline side by side, joined without re-encoding), audio.py makes the
 * soundtrack from the score the scenes export (`VIDEO.score()`: the beat, the drops, every click and cut),
 * and ffmpeg brings it to -14 LUFS (two passes) and muxes it in as AAC.
 *
 *   npx tsx design/video/render.ts                      the video with sound, 1920×1080 at 60 fps → out/
 *   npx tsx design/video/render.ts --audio-only         the soundtrack again, onto the last rendered picture
 *   npx tsx design/video/render.ts --music track.mp3    your own music under the video's sound effects
 *   npx tsx design/video/render.ts --no-audio           the picture only
 *   npx tsx design/video/render.ts --still 12.5,30      frames as PNGs (to look at a moment)
 *   npx tsx design/video/render.ts --score              the score alone (out/score.json), for audio.py
 *   npx tsx design/video/render.ts --fps 30 --scale 0.5 a quick, small preview
 *   npx tsx design/video/render.ts --gif 4 11.4         a silent clip and a GIF of seconds 4 to 11.4
 *
 * Needs Playwright with Chromium (`npx playwright install chromium` on a new machine), ffmpeg, and Python 3
 * with numpy and scipy for the soundtrack. The bots come from site/foods.js and the brand marks from the
 * app's logo table, so they match the app.
 */
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
/** Every brand mark the markup names. */
const USED = [...new Set([...readFileSync(join(here, "index.html"), "utf8").matchAll(/data-logo="([a-z0-9-]+)"/g)].map((m) => m[1]!))];

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
const audioOnly = args.includes("--audio-only");
const silent = args.includes("--no-audio");
const music = args.includes("--music") ? opt("music", "") : null;

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

/** The score the scenes export: the beat, where the drops fall, every sound's moment. */
async function writeScore() {
  const { browser, p } = await page();
  const score = await p.evaluate(() => (window as unknown as { VIDEO: { score(): unknown } }).VIDEO.score());
  await browser.close();
  const scoreFile = join(out, "score.json");
  writeFileSync(scoreFile, JSON.stringify(score, null, 1));
  return scoreFile;
}

/** The soundtrack, from the score, brought to -14 LUFS (YouTube's level) and muxed onto the picture. */
async function soundtrack(picture: string, final: string) {
  const scoreFile = await writeScore();
  const wav = join(out, "soundtrack.wav");
  execFileSync("python3", [join(here, "audio.py"), "--score", scoreFile, "--out", wav, ...(music ? ["--music", music] : [])], { stdio: "inherit" });
  // Two-pass loudness: measure, then a linear correction to exactly -14 LUFS with -1 dBTP headroom.
  const target = "I=-14:TP=-1.0:LRA=11";
  const measured = spawnSync("ffmpeg", ["-hide_banner", "-i", wav, "-af", `loudnorm=${target}:print_format=json`, "-f", "null", "-"], { encoding: "utf8" }).stderr;
  const m = JSON.parse(measured.slice(measured.lastIndexOf("{"), measured.lastIndexOf("}") + 1)) as Record<string, string>;
  const second = `loudnorm=${target}:measured_I=${m.input_i}:measured_TP=${m.input_tp}:measured_LRA=${m.input_lra}:measured_thresh=${m.input_thresh}:offset=${m.target_offset}:linear=true`;
  await ffmpeg([
    "-i", picture, "-i", wav, "-map", "0:v", "-map", "1:a", "-c:v", "copy",
    "-af", second, "-ar", "48000", "-c:a", "aac", "-b:a", "256k", "-shortest", "-movflags", "+faststart", final,
  ]).done;
  console.log(`${final} (soundtrack measured at ${m.input_i} LUFS, now -14)`);
}

async function main() {
  mkdirSync(out, { recursive: true });
  if (args.includes("--score")) return console.log(await writeScore());
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
  const name = `mcbot-studio-launch-${Math.round(H * Math.min(1, scale))}p${fps}`;
  const picture = join(out, `${name}-picture.mp4`);
  const final = join(out, `${name}.mp4`);
  if (audioOnly) {
    if (!existsSync(picture)) throw new Error(`No picture to put the sound on yet: render once without --audio-only (${picture})`);
    return soundtrack(picture, final);
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
  const mp4 = gifAt >= 0 ? join(out, "clip.mp4") : picture;
  await ffmpeg(["-f", "concat", "-safe", "0", "-i", join(tmp, "list.txt"), "-c", "copy", "-movflags", "+faststart", mp4]).done;
  rmSync(tmp, { recursive: true, force: true });
  if (gifAt >= 0) {
    const gif = join(out, `mcbot-studio-${from}-${to}.gif`);
    await ffmpeg(["-i", mp4, "-vf", "fps=24,scale=960:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=128:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle", gif]).done;
    console.log(gif);
    return;
  }
  if (silent) return console.log(picture);
  await soundtrack(picture, final);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
