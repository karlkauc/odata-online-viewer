// Screenshots of the main views for the README and the Open Graph image.
//
//   cd e2e && node scripts/screenshots.mjs [baseUrl]
//
// Uses the bare `playwright` package installed in e2e/ (hence the location). Loads the bundled
// Northwind V4 snapshot (no network needed) and writes docs/media/*.png plus
// frontend/public/og-image.png (1200×630, the diagram view).

import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const base = process.argv[2] ?? "http://127.0.0.1:8094";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const media = resolve(root, "docs/media");
mkdirSync(media, { recursive: true });

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, colorScheme: "light" });
const page = await context.newPage();
await page.route("**/api/samples/northwind-v4/load**", (route) =>
  route.continue({ url: route.request().url().replace(/\?.*$/, "") + "?live=false" }),
);

await page.goto(base + "/");
await page.waitForSelector("text=See what an OData service looks like");
await page.screenshot({ path: resolve(media, "01-landing.png") });

await page.getByRole("button", { name: "Northwind (OData V4)", exact: true }).click();
await page.waitForSelector("text=northwind-v4.xml");
// Collapse the loader so the views get the room.
await page.getByRole("button", { name: /^Service/ }).click();
await page.getByRole("treeitem", { name: "Order", exact: true }).click();
await page.waitForSelector("text=Navigation properties");
await page.screenshot({ path: resolve(media, "02-details.png") });

await page.getByRole("tab", { name: "Diagram" }).click();
await page.waitForSelector(".react-flow__node", { timeout: 30_000 });
await page.waitForTimeout(1200); // fitView animation
await page.screenshot({ path: resolve(media, "03-diagram.png") });

await page.getByRole("tab", { name: "Source" }).click();
await page.waitForSelector(".cm-content");
await page.waitForTimeout(400);
await page.screenshot({ path: resolve(media, "04-source.png") });

// Data explorer with a canned answer (the snapshot has no service root, so fake one).
await page.getByRole("tab", { name: "Details" }).click();
await page.screenshot({ path: resolve(media, "05-overview.png") });

// Open Graph image: the diagram, focused on Order, 1200×630.
const og = await browser.newPage({ viewport: { width: 1200, height: 725 }, deviceScaleFactor: 1, colorScheme: "light" });
await og.route("**/api/samples/northwind-v4/load**", (route) =>
  route.continue({ url: route.request().url().replace(/\?.*$/, "") + "?live=false" }),
);
await og.goto(base + "/samples");
await og.getByRole("button", { name: /^Northwind \(OData V4\) V4\.0/ }).click();
await og.waitForSelector("text=northwind-v4.xml");
await og.getByRole("button", { name: /^Service/ }).click();
await og.getByRole("treeitem", { name: "Order", exact: true }).click();
await og.getByRole("tab", { name: "Diagram" }).click();
await og.waitForSelector(".react-flow__node", { timeout: 30_000 });
await og.waitForTimeout(1500);
await og.screenshot({ path: resolve(root, "frontend/public/og-image.png"), clip: { x: 0, y: 95, width: 1200, height: 630 } });

await browser.close();
console.log("screenshots written to", media, "and frontend/public/og-image.png");
