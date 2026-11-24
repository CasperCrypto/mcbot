/**
 * McBot Studio's app icon: the glass burger (the website's hero, site/assets/burger.webp, with its
 * eyes) on a near-black tile. Two renders from one page:
 *   design/icon-1024.png       macOS: Apple's icon grid (an 824px body on a 1024 canvas)
 *   design/icon-full-1024.png  Windows and Linux: the tile fills the canvas, as their icons do
 *   site/assets/icon-180.png   the website's home-screen icon (square; the phone rounds it)
 * then Tauri's icon set from the full one, with macOS's .icns from the grid one.
 * Needs Playwright with its Chromium on this machine (`NODE_PATH=$(npm root -g)` for a global one).
 * Run: npm run app:icon
 */
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

// Playwright is the machine's own (as for the README screenshots), not a project dependency:
// required, so NODE_PATH can point at a global install.
const { chromium } = createRequire(import.meta.url)("playwright");

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const burger = `data:image/webp;base64,${readFileSync(join(root, "site/assets/burger.webp")).toString("base64")}`;

/** The icon as a page: `inset` and `radius` shape the tile, `width` sizes the burger. */
const page = ({ inset, radius, width }) => `<!doctype html><html><head><style>
  html, body { margin: 0; background: transparent; }
  #icon { position: relative; width: 1024px; height: 1024px; }
  .tile {
    position: absolute; inset: ${inset}px; border-radius: ${radius}px; overflow: hidden;
    background: linear-gradient(180deg, #232327 0%, #0e0e10 58%, #070708 100%);
    box-shadow: inset 0 3px 0 rgba(255, 255, 255, 0.09), inset 0 0 0 2px rgba(255, 255, 255, 0.075);
  }
  .bot { position: absolute; left: 50%; top: 51%; width: ${width}px; aspect-ratio: 978 / 937; transform: translate(-50%, -50%); }
  .bot img { position: absolute; inset: 0; width: 100%; height: 100%; }
  .eye { position: absolute; overflow: hidden; border-radius: 50%; }
  .eye.l { left: 43.9%; top: 21.6%; width: 4.3%; height: 12.9%; }
  .eye.r { left: 59.2%; top: 22.4%; width: 3.7%; height: 12.3%; }
  .eye i { position: absolute; left: 50%; top: 50%; width: 72%; height: 54%; border-radius: 999px; background: #fff; transform: translate(-50%, -46%); }
</style></head><body><div id="icon"><div class="tile"></div><div class="bot"><img src="${burger}" alt=""><span class="eye l"><i></i></span><span class="eye r"><i></i></span></div></div></body></html>`;

const browser = await chromium.launch();
const tab = await browser.newPage({ viewport: { width: 1024, height: 1024 }, deviceScaleFactor: 1 });
async function render(opts, out, size = 1024) {
  await tab.setViewportSize({ width: size, height: size });
  await tab.setContent(page(opts).replace("<body>", `<body style="zoom:${size / 1024}">`));
  await tab.waitForTimeout(150);
  await tab.locator("#icon").screenshot({ path: out, omitBackground: true });
  console.log(`wrote ${out}`);
}
await render({ inset: 100, radius: 186, width: 690 }, join(root, "design/icon-1024.png"));
await render({ inset: 16, radius: 220, width: 860 }, join(root, "design/icon-full-1024.png"));
// The website's home-screen icon: square and opaque (the phone rounds it).
await render({ inset: 0, radius: 0, width: 860 }, join(root, "site/assets/icon-180.png"), 180);
await browser.close();

// Tauri's set from the full-size tile, macOS's .icns from the grid one. Tauri writes more than the app
// uses (mobile sets): only the files already in src-tauri/icons are replaced; the tray icon is its own.
const tauri = join(root, "node_modules/.bin/tauri");
const icons = join(root, "src-tauri/icons");
const keep = readdirSync(icons).filter((f) => f !== "tray.png" && statSync(join(icons, f)).isFile());
const full = mkdtempSync(join(tmpdir(), "mcbot-icon-"));
const mac = mkdtempSync(join(tmpdir(), "mcbot-icon-mac-"));
try {
  execFileSync(tauri, ["icon", join(root, "design/icon-full-1024.png"), "-o", full], { stdio: "ignore" });
  execFileSync(tauri, ["icon", join(root, "design/icon-1024.png"), "-o", mac], { stdio: "ignore" });
  for (const f of keep) copyFileSync(join(f === "icon.icns" ? mac : full, f), join(icons, f));
  console.log(`wrote ${keep.length} files in src-tauri/icons (icon.icns on macOS's grid)`);
} finally {
  rmSync(full, { recursive: true, force: true });
  rmSync(mac, { recursive: true, force: true });
}
