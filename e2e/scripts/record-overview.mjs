// Animated overview for the README: records a short tour of the UI and converts it to
// docs/media/overview.gif.
//
//   cd e2e && node scripts/record-overview.mjs [baseUrl]
//
// Needs ffmpeg on the PATH and network access: the Northwind sample is loaded live so the data
// explorer has a real service to query. The raw .webm stays in docs/media/_raw/ (git-ignored).

import { chromium } from "playwright";
import { execFileSync } from "node:child_process";
import { mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const base = process.argv[2] ?? "http://127.0.0.1:8094";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const media = resolve(root, "docs/media");
const raw = resolve(media, "_raw");
rmSync(raw, { recursive: true, force: true });
mkdirSync(raw, { recursive: true });

const size = { width: 1280, height: 800 };
const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: size,
  deviceScaleFactor: 1,
  colorScheme: "light",
  recordVideo: { dir: raw, size },
});
const page = await context.newPage();
const pause = (ms) => page.waitForTimeout(ms);

await page.goto(base + "/");
await page.getByRole("heading", { name: "See what an OData service looks like" }).waitFor();
await pause(1500);

await page.getByRole("button", { name: "Northwind (OData V4)", exact: true }).click();
await page.getByRole("treeitem", { name: /^Entity types/ }).waitFor({ timeout: 30_000 });
await pause(1200);
// Collapse the loader so the views get the room.
await page.getByRole("button", { name: /^Service/ }).click();
await pause(600);

await page.getByRole("treeitem", { name: "Order", exact: true }).click();
await page.getByText("Navigation properties").first().waitFor();
await pause(2200);

await page.getByRole("tab", { name: "Diagram" }).click();
await page.locator(".react-flow__node").first().waitFor({ timeout: 30_000 });
await pause(3000);

await page.getByRole("tab", { name: "Data" }).click();
await page.getByRole("combobox", { name: "Entity set" }).selectOption("Orders");
await pause(600);
await page.getByRole("button", { name: "Run" }).click();
const sortHeader = page.getByRole("columnheader", { name: /CustomerID/ });
await sortHeader.waitFor({ timeout: 30_000 });
await pause(2200);
await sortHeader.getByRole("button").click();
await page.waitForLoadState("networkidle");
await pause(2200);

await page.getByRole("tab", { name: "Source" }).click();
await page.locator(".cm-content").waitFor();
await pause(2000);

await page.keyboard.press("Control+k");
await page.getByRole("textbox", { name: "Search the model" }).pressSequentially("Customer", { delay: 120 });
await pause(1200);
await page.getByRole("option").first().click();
await pause(2500);

const video = page.video();
await context.close();
await browser.close();
const webm = await video.path();

// The webm's compression noise makes almost every frame differ; mpdecimate drops the
// near-duplicates (variable frame rate keeps the timing), which shrinks the GIF about fourfold.
const gif = resolve(media, "overview.gif");
execFileSync("ffmpeg", [
  "-y", "-loglevel", "error", "-i", webm,
  "-vf", "fps=8,scale=960:-1:flags=lanczos,mpdecimate=hi=64*24:lo=64*8:frac=0.1,split[a][b];" +
    "[a]palettegen=max_colors=128:stats_mode=diff[p];[b][p]paletteuse=dither=none:diff_mode=rectangle",
  "-fps_mode", "vfr", "-loop", "0", gif,
]);
console.log(`${gif}: ${(statSync(gif).size / 1e6).toFixed(1)} MB (raw: ${readdirSync(raw).join(", ")})`);
